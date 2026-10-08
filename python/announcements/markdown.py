"""公告解析结果 → Markdown 组装（纯函数，便于单独调试）。"""


def to_markdown(parsed: dict) -> str:
    parts = []
    for page in parsed.get("pages", []):
        parts.append(f"## Page {page['page']}")
        text = page.get("text", "")
        if text:
            parts.append(text)
        for table in page.get("tables", []):
            md_table = _table_to_markdown(table)
            if md_table:
                parts.append(md_table)
    return "\n\n".join(parts)


def _table_to_markdown(table: list) -> str:
    if not table:
        return ""

    ncols = max(len(row) for row in table)
    rows = [[_cell(row[i] if i < len(row) else None) for i in range(ncols)] for row in table]

    lines = ["| " + " | ".join(rows[0]) + " |"]
    lines.append("| " + " | ".join(["---"] * ncols) + " |")
    for row in rows[1:]:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _cell(value) -> str:
    """None/空 → 单空格占位；换行 → <br>；转义 `|` 避免破坏表格边界。"""
    if value is None:
        return " "
    text = str(value).replace("\n", "<br>").replace("|", "\\|")
    return text if text.strip() else " "
