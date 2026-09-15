#!/usr/bin/env python3
"""Import an EPUB into the Co-Reading MCP chunk format.

This is deliberately dependency-light. It reads the EPUB zip, extracts XHTML/HTML
documents in spine order when possible, falls back to all HTML files otherwise,
strips tags, and writes chunks while preserving spine item boundaries.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path, PurePosixPath

from import_text import decode_text_bytes, slugify, write_book_sections


CONTAINER = "META-INF/container.xml"


def ns_name(name: str) -> str:
    return name.split("}", 1)[-1]


def strip_tags(raw: str) -> str:
    raw = re.sub(r"(?is)<[^>]+>", " ", raw)
    raw = html.unescape(raw)
    raw = re.sub(r"\s+", " ", raw)
    return raw.strip()


def title_from_html(raw: str) -> str | None:
    for match in re.finditer(r"(?is)<h[1-3][^>]*>(.*?)</h[1-3]>", raw):
        title = strip_tags(match.group(1))
        if title:
            return title
    title_match = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
    if title_match:
        title = strip_tags(title_match.group(1))
        if title:
            return title
    return None


def text_from_html(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</(p|div|section|article|h[1-6]|li|tr)>", "\n\n", raw)
    raw = re.sub(r"(?is)<[^>]+>", " ", raw)
    raw = html.unescape(raw)
    raw = re.sub(r"[ \t\r\f\v]+", " ", raw)
    raw = re.sub(r"\n\s*\n\s*\n+", "\n\n", raw)
    return raw.strip()


def sections_from_html_headings(raw: str) -> list[dict[str, str]]:
    matches = list(re.finditer(r"(?is)<h[1-3][^>]*>.*?</h[1-3]>", raw))
    if len(matches) < 2:
        return []

    sections = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(raw)
        title = strip_tags(match.group(0)) or f"Section {index + 1}"
        text = text_from_html(raw[start:end])
        if text:
            sections.append({"title": title, "text": text})
    return sections


def should_split_html_by_headings(raw: str, text: str, ordered_count: int) -> bool:
    sections = sections_from_html_headings(raw)
    return len(sections) >= 2 and (ordered_count == 1 or len(text) > 12000)


def clean_metadata_title(value: str | None, fallback: str) -> str:
    title = (value or "").strip()
    if not title or title.lower() in {"unknown", "untitled", "administrator"} or len(title) <= 1:
        return fallback
    return title


def clean_metadata_author(value: str | None, title: str) -> str | None:
    author = (value or "").strip()
    if not author or author.lower() in {"unknown", "administrator"} or author == title:
        return None
    return author


def find_opf_path(zf: zipfile.ZipFile) -> str | None:
    try:
        root = ET.fromstring(zf.read(CONTAINER))
    except Exception:
        return None

    for element in root.iter():
        if ns_name(element.tag) == "rootfile":
            full_path = element.attrib.get("full-path")
            if full_path:
                return full_path
    return None


def parse_opf(
    zf: zipfile.ZipFile, opf_path: str
) -> tuple[str | None, str | None, list[str], list[dict[str, str]]]:
    root = ET.fromstring(zf.read(opf_path))
    # EPUB archive paths always use POSIX separators, including on Windows.
    opf_dir = str(PurePosixPath(opf_path).parent)
    if opf_dir == ".":
        opf_dir = ""

    title = None
    author = None
    manifest: dict[str, str] = {}
    spine_ids: list[str] = []
    toc_path = None

    for element in root.iter():
        local = ns_name(element.tag)
        if local == "title" and element.text and title is None:
            title = element.text.strip()
        elif local == "creator" and element.text and author is None:
            author = element.text.strip()
        elif local == "item":
            item_id = element.attrib.get("id")
            href = element.attrib.get("href")
            media_type = element.attrib.get("media-type", "")
            properties = element.attrib.get("properties", "")
            if item_id and href and ("html" in media_type or href.lower().endswith((".html", ".xhtml", ".htm"))):
                manifest[item_id] = str(PurePosixPath(opf_dir) / href) if opf_dir else href
            if href and ("nav" in properties.split() or media_type == "application/x-dtbncx+xml"):
                toc_path = str(PurePosixPath(opf_dir) / href) if opf_dir else href
        elif local == "itemref":
            ref = element.attrib.get("idref")
            if ref:
                spine_ids.append(ref)

    ordered = [manifest[item_id] for item_id in spine_ids if item_id in manifest]
    toc_entries = parse_toc_entries(zf, toc_path) if toc_path else []
    return title, author, ordered, toc_entries


def parse_toc_entries(zf: zipfile.ZipFile, toc_path: str) -> list[dict[str, str]]:
    try:
        raw = zf.read(toc_path)
    except KeyError:
        return []

    entries: list[dict[str, str]] = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return entries

    toc_dir = str(PurePosixPath(toc_path).parent)
    if toc_dir == ".":
        toc_dir = ""

    def append_entry(href: str | None, title: str | None) -> None:
        if not href or not title:
            return
        path_part, _, fragment = href.partition("#")
        normalized_path = str(PurePosixPath(toc_dir) / path_part) if toc_dir and path_part else path_part
        entries.append({"path": normalized_path, "fragment": fragment, "title": title.strip()})

    # EPUB 2 NCX: use direct navMap children so nested subsection links do not
    # turn every h2/h3 into a top-level reading chapter.
    nav_map = next((element for element in root.iter() if ns_name(element.tag) == "navMap"), None)
    if nav_map is not None:
        for nav_point in [child for child in nav_map if ns_name(child.tag) == "navPoint"]:
            label = next((child.text.strip() for child in nav_point.iter() if ns_name(child.tag) == "text" and child.text and child.text.strip()), None)
            content = next((child.attrib.get("src") for child in nav_point.iter() if ns_name(child.tag) == "content" and child.attrib.get("src")), None)
            append_entry(content, label)
        if entries:
            return entries

    # EPUB 3 navigation document: direct li children are the book's top-level
    # TOC. Nested links remain subheadings inside their parent chapter.
    nav = next((element for element in root.iter() if ns_name(element.tag) == "nav"), None)
    ordered_list = next((element for element in nav.iter() if ns_name(element.tag) == "ol"), None) if nav is not None else None
    if ordered_list is not None:
        for item in [child for child in ordered_list if ns_name(child.tag) == "li"]:
            anchor = next((child for child in item if ns_name(child.tag) == "a"), None)
            if anchor is None:
                anchor = next((child for child in item.iter() if ns_name(child.tag) == "a"), None)
            if anchor is not None:
                append_entry(anchor.attrib.get("href"), "".join(anchor.itertext()).strip())

    return entries


def sections_from_toc_fragments(raw: str, name: str, entries: list[dict[str, str]]) -> list[dict[str, str]]:
    candidates = [entry for entry in entries if entry["path"] == name and entry.get("fragment")]
    located = []
    for entry in candidates:
        fragment = re.escape(html.unescape(entry["fragment"]))
        match = re.search(rf"(?i)\b(?:id|name)\s*=\s*(['\"]){fragment}\1", raw)
        if not match:
            continue
        tag_start = raw.rfind("<", 0, match.start())
        located.append((max(0, tag_start), entry))
    located.sort(key=lambda value: value[0])
    if len(located) < 2:
        return []

    sections = []
    for index, (start, entry) in enumerate(located):
        end = located[index + 1][0] if index + 1 < len(located) else len(raw)
        text = text_from_html(raw[start:end])
        if text:
            sections.append({"title": entry["title"], "text": text, "sourcePath": f"{name}#{entry['fragment']}"})
    return sections


def normalized_title(value: str | None) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", " ", (value or "").lower()).strip()


def is_front_matter(section: dict[str, str], book_title: str | None) -> bool:
    title = normalized_title(section.get("title"))
    source = (section.get("sourcePath") or "").lower()
    source_name = PurePosixPath(source.split("#", 1)[0]).name
    book = normalized_title(book_title)
    known_titles = (
        "cover", "half title", "title page", "copyright", "contents", "table of contents",
        "dedication", "epigraph", "acknowledgments", "acknowledgements", "preface",
        "list of illustrations", "list of figures", "list of tables", "series information",
        "书名页", "版权", "版权信息", "目录", "致谢", "鸣谢", "序言", "前言",
    )
    source_markers = ("_fm_", "frontmatter", "front-matter", "halftitle", "titlepage", "titleverso")
    if any(marker in source_name for marker in source_markers):
        return True
    if re.fullmatch(r"[ivxlcdm]+", title):
        return True
    if any(title == known or title.startswith(f"{known} and ") for known in known_titles):
        return True
    return bool(book and len(book) >= 8 and (title == book or title.startswith(f"{book} ")))


def merge_leading_front_matter(sections: list[dict[str, str]], book_title: str | None) -> list[dict[str, str]]:
    leading = []
    index = 0
    while index < len(sections) and is_front_matter(sections[index], book_title):
        leading.append(sections[index])
        index += 1
    if not leading:
        return sections
    text = "\n\n".join(f"## {section['title']}\n\n{section['text']}" for section in leading)
    merged = {
        "title": "书前页",
        "text": text,
        "sourcePath": ";".join(section.get("sourcePath") or "" for section in leading),
        "sectionKind": "frontmatter",
    }
    return [merged, *sections[index:]]


def html_files(zf: zipfile.ZipFile) -> list[str]:
    return sorted(
        name
        for name in zf.namelist()
        if name.lower().endswith((".html", ".xhtml", ".htm")) and not name.endswith("/")
    )


def read_epub(path: Path) -> tuple[str | None, str | None, list[dict[str, str]]]:
    with zipfile.ZipFile(path) as zf:
        opf_path = find_opf_path(zf)
        title = None
        author = None
        ordered: list[str] = []
        toc_entries: list[dict[str, str]] = []
        if opf_path:
            try:
                title, author, ordered, toc_entries = parse_opf(zf, opf_path)
            except Exception:
                ordered = []
        if not ordered:
            ordered = html_files(zf)

        sections = []
        for index, name in enumerate(ordered):
            try:
                raw, enc = decode_text_bytes(zf.read(name))
                if enc not in {"utf-8", "utf-8-sig"}:
                    print(f"[import_epub] decoded {name} as {enc}", flush=True)
            except Exception:
                raw = zf.read(name).decode("utf-8", errors="replace")
            except KeyError:
                continue
            text = text_from_html(raw)
            toc_sections = sections_from_toc_fragments(raw, name, toc_entries)
            if toc_sections:
                sections.extend(toc_sections)
                continue
            if len(ordered) == 1 and should_split_html_by_headings(raw, text, len(ordered)):
                for section_index, section in enumerate(sections_from_html_headings(raw)):
                    sections.append(
                        {
                            "title": section["title"],
                            "text": section["text"],
                            "sourcePath": f"{name}#heading-{section_index + 1}",
                        }
                    )
                continue
            if text:
                toc_title = next((entry["title"] for entry in toc_entries if entry["path"] == name), None)
                section_title = toc_title or title_from_html(raw) or f"Section {index + 1}"
                sections.append({"title": section_title, "text": text, "sourcePath": name})

    return title, author, merge_leading_front_matter(sections, title)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--title")
    parser.add_argument("--author")
    parser.add_argument("--book-id")
    parser.add_argument("--out", type=Path, default=Path("data/books"))
    parser.add_argument("--max-chars", type=int, default=6000)
    args = parser.parse_args()

    title, author, sections = read_epub(args.input)
    final_title = args.title or clean_metadata_title(title, args.input.stem)
    final_author = args.author or clean_metadata_author(author, final_title)
    if not final_author and args.title and title and title != final_title:
        maybe_author = clean_metadata_title(title, "")
        if maybe_author and maybe_author != final_title:
            final_author = maybe_author
    book_id = args.book_id or slugify(final_title)

    if not sections:
        print("No readable text found in EPUB", file=sys.stderr)
        raise SystemExit(1)

    book_dir = write_book_sections(
        sections,
        final_title,
        final_author,
        args.out,
        book_id,
        args.max_chars,
        {"type": "epub", "fileName": args.input.name},
    )
    print(book_dir)


if __name__ == "__main__":
    main()
