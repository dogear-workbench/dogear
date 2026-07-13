"""公告 PDF 结构化解析。"""

import pdfplumber


def parse_pdf(path: str) -> dict:
    """
    解析 PDF 为逐页结构化数据。

    返回: {"pages": [{"page": 1, "text": "...", "tables": [[["a","b"],["c","d"]], ...]}]}
    """
    pages = []
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = (page.extract_text() or "").strip()
            tables = []
            for table in page.extract_tables():
                cleaned = [row for row in table if any(cell not in (None, "") for cell in row)]
                if cleaned:
                    tables.append(cleaned)
            pages.append({"page": i, "text": text, "tables": tables})
    return {"pages": pages}
