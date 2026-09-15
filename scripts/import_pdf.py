#!/usr/bin/env python3
"""Extract a text PDF into the Co-Reading MCP chunk format."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from pypdf import PdfReader

from import_text import write_book_sections


def clean_page_text(value: str | None) -> str:
    text = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(?<=\w)-\n(?=\w)", "", text)
    blocks: list[str] = []
    current: list[str] = []
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if line:
            current.append(line)
        elif current:
            blocks.append(" ".join(current))
            current = []
    if current:
        blocks.append(" ".join(current))
    return "\n\n".join(blocks).strip()


def group_pages(pages: list[tuple[int, str]], target_chars: int) -> list[dict[str, str]]:
    groups: list[dict[str, str]] = []
    current: list[tuple[int, str]] = []
    current_chars = 0

    def flush() -> None:
        nonlocal current, current_chars
        if not current:
            return
        start_page, end_page = current[0][0], current[-1][0]
        title = f"Page {start_page}" if start_page == end_page else f"Pages {start_page}-{end_page}"
        groups.append(
            {
                "title": title,
                "text": "\n\n".join(text for _, text in current),
                "sourcePath": f"pages/{start_page}-{end_page}",
            }
        )
        current = []
        current_chars = 0

    for page_number, text in pages:
        if current and current_chars + len(text) > target_chars:
            flush()
        current.append((page_number, text))
        current_chars += len(text)
    flush()
    return groups


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--title", required=True)
    parser.add_argument("--author")
    parser.add_argument("--book-id")
    parser.add_argument("--out", type=Path, default=Path("data/books"))
    parser.add_argument("--max-chars", type=int, default=6000)
    args = parser.parse_args()

    reader = PdfReader(args.input)
    pages: list[tuple[int, str]] = []
    for index, page in enumerate(reader.pages, start=1):
        text = clean_page_text(page.extract_text())
        if text:
            pages.append((index, text))

    extracted = "".join(text for _, text in pages)
    alphabetic_chars = len(re.findall(r"[A-Za-z]", extracted))
    if len(extracted.strip()) < 80 or alphabetic_chars < 40:
        raise SystemExit(
            "This PDF has no usable extractable English text. It may be a scanned PDF; run OCR first, then import it again."
        )

    metadata = reader.metadata or {}
    author = args.author or (str(metadata.get("/Author", "")).strip() or None)
    sections = group_pages(pages, max(1200, args.max_chars))
    book_dir = write_book_sections(
        sections,
        args.title,
        author,
        args.out,
        args.book_id,
        args.max_chars,
        {
            "type": "pdf",
            "pageCount": len(reader.pages),
            "textPages": len(pages),
            "extractor": "pypdf",
        },
    )
    print(book_dir)


if __name__ == "__main__":
    main()
