# 修复说明（大白话）

## 修了什么

### 1. 复习「下一题」保存失败
- **根因**：写入 `Documents\English Co-Reading\english_review_state.json` 时 Windows 报 `EPERM`（文件被占用/OneDrive 同步/多个 `http.js` 进程抢写）。
- **改动**：
  - `src/learning-system.js`：写 JSON 改为「先写临时文件再替换」，并对 `EPERM/EBUSY/EACCES` 自动重试。
  - `public/review.js`：`api()` 更耐用（非 JSON 错误也能读出来）；「下一题 / 认识了 / 还要复习」保存失败时自动重试几次。

### 2. 导入书籍乱码 / 内容不全
- **根因**：`import_text.py` 只用 UTF-8 读 TXT；EPUB 里个别 HTML 实际是 GBK/GB18030，旧逻辑 `errors=ignore` 会丢字或乱码。
- **改动**：
  - `scripts/import_text.py`：自动尝试 UTF-8 / GB18030 / GBK / Big5 / UTF-16。
  - `scripts/import_epub.py`：章节 HTML 用同一套解码，不再粗暴忽略坏字节。

### 3. 玄关随机壁纸
- **改动**：
  - 把 `pattern-birds.png`、`pattern-floral.png` 放到 `public/assets/patterns/`。
  - 玄关每天固定抽一张（两张 pattern + 可选 botanical-moss/cream），上面加纸色 wash，保证字可读。
  - **阅读页不加这套壁纸**，不影响正文阅读。

## 改了哪些文件
- `src/learning-system.js`
- `src/http-routes.js`（补 png/webp 等静态类型）
- `public/review.js`
- `public/natural-editorial.css`
- `public/review.html` / `public/reader.html`（缓存参数 `?v=20260905h`）
- `scripts/import_text.py` / `scripts/import_epub.py`
- `public/assets/patterns/pattern-birds.png`
- `public/assets/patterns/pattern-floral.png`
- `CHANGELOG-FIXES.md`（本文件）

### 6. 滚动不卡 + 书名去杂质 + 新纹样
- 字母不再用 `background-attachment: fixed`，滑出玄关就先藏起来，下拉会顺很多。
- 书名后面的 `_z-library.sk_ 1lib.sk_` 这类字只在显示时去掉，不改你存着的书数据。
- 新加了 7 张纹样进轮换：印花、蓝蝶、黄蝶、蓝线描、花园、牡丹、海洋。

### 5. 玄关每次刷新都换
- 底图、书、大字母里的纹样，刷新一次换一套（尽量不连续重复同一张/同一本）。
- 句子优先用这本里你划过的；没有划线，就从正文里摘一句完整的，不从目录/书前页乱抽。
- 地址带 `?book=某本书` 时，仍固定显示那一本。

### 4. 字母缝隙跟着底图轮换 + 目录层级
- 玄关大字母不再写死旧苔藓图，改成和当天底图同一张纹样；字母是“剪影窗口”，纹样从字形里露出来。
- 阅读页正文首字母仍用原来的安静植物图，不铺花底。
- 目录里 `Chapter 2` / `第3章` 会单独成章：章号小、标题大、上面有分隔；`Virtual machines` 这类小节会缩进、字更轻。

## 你怎么刷新看到效果
1. **重启**本项目的 HTTP 服务（例如 8793 上的 `node src/http.js`），否则旧进程还在内存里用旧的 `learning-system.js`。
2. 浏览器打开玄关页后 **强制刷新**：`Ctrl+F5`（或 Cmd+Shift+R）。
3. 确认地址栏/网络面板里 CSS/JS 带 `?v=20260905m`。
4. 若仍偶发保存失败：先关掉多余的旧 `node src/http.js` 进程，只留一个；尽量别让 OneDrive 正疯狂同步 `Documents\English Co-Reading`。
