#!/usr/bin/env python3
"""Offline, opt-in Japanese OCR sidecar for Comic Workbench.
Requires locally installed Tesseract 5 and jpn/jpn_vert traineddata.
No network, image upload, API or Canon mutation. Stdlib only; PNG input.
"""
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys

SCHEMA = "comic-ocr-candidates/v1"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 4_000_000
MAX_CANDIDATES = 80


def inspect_png(data):
    if len(data) < 33 or data[:8] != PNG_MAGIC or data[12:16] != b"IHDR":
        raise ValueError("入力はPNG画像のみ対応です")
    width, height = struct.unpack(">II", data[16:24])
    if width < 1 or height < 1 or width * height > MAX_PIXELS:
        raise ValueError("画像は400万画素以内にしてください")
    return width, height


def parse_tsv(tsv, width, height, language):
    if language not in ("jpn", "jpn_vert"):
        raise ValueError("未対応のOCR言語です")
    reader = csv.DictReader(io.StringIO(tsv), delimiter="\t")
    if not reader.fieldnames or not {"level", "block_num", "par_num", "line_num",
                                      "word_num", "left", "top", "width", "height",
                                      "conf", "text"}.issubset(reader.fieldnames):
        raise ValueError("OCRのTSV形式が不正です")
    groups = {}
    for row in reader:
        if row["level"] != "5":
            continue
        text = row["text"]
        if not text.strip():
            continue
        try:
            left, top = int(row["left"]), int(row["top"])
            w, h = int(row["width"]), int(row["height"])
            conf = float(row["conf"])
            block, par, line = int(row["block_num"]), int(row["par_num"]), int(row["line_num"])
            number = int(row["word_num"])
        except (TypeError, ValueError) as exc:
            raise ValueError("OCR出力の文字・座標が不正です") from exc
        if w < 1 or h < 1 or left < 0 or top < 0 or left+w > width or top+h > height:
            continue
        if conf < 0 or conf > 100:
            continue
        key = (block, par, line)
        groups.setdefault(key, []).append((number, text, left, top, w, h, conf))
    result = []
    for group in groups.values():
        group.sort(key=lambda x: x[0])
        # jpn models may separate ideograms with artificial spaces. The raw OCR
        # candidate is joined without adding spaces; this is not an authoritative transcript.
        text = "".join(item[1] for item in group)[:1200]
        if not text.strip():
            continue
        x1 = min(x[2] for x in group)
        y1 = min(x[3] for x in group)
        x2 = max(x[2]+x[4] for x in group)
        y2 = max(x[3]+x[5] for x in group)
        average = round(sum(x[6] for x in group) / len(group), 3)
        result.append({
            "text": text,
            "confidence": average,
            "bounds": {"x": round(x1/width, 6),
                       "y": round(y1/height, 6),
                       "width": round((x2-x1)/width, 6),
                       "height": round((y2-y1)/height, 6)}
        })
    if len(result) > MAX_CANDIDATES:
        # Silent truncation could omit text and lead to a misleading QA result.
        raise ValueError("OCR候補が80件を超えました。対象のコマを小さく切り出して再実行してください")
    return result


def build_record(image, data, width, height, language, psm, candidates, version):
    return {
        "schema": SCHEMA,
        "image": {"sha256": hashlib.sha256(data).hexdigest(),
                  "width": width, "height": height, "bytes": len(data)},
        "engine": {"name": "tesseract-cli", "language": language,
                   "pageSegmentationMode": psm, "version": version[:70]},
        "candidates": candidates,
        "safety": {"humanReviewRequired": True, "automaticallyVerified": False,
                   "canonApproved": False},
        "notice": "文字候補であって正式原稿・画像QAの自動PASSではありません。"
    }


def main(argv=None):
    p = argparse.ArgumentParser(description="実画像をローカルTesseractでOCR。ネット送信は一切なし")
    p.add_argument("--image", required=True, help="PNG画像（最大10MB、400万画素）")
    p.add_argument("--output", required=True, help="新規作成する候補JSON")
    p.add_argument("--lang", choices=("jpn", "jpn_vert"), default="jpn")
    p.add_argument("--psm", type=int, choices=(3, 5, 6, 11, 12), default=6)
    p.add_argument("--timeout",type=int,choices=(10,20,30,50),default=30,
                   help="ローカルOCR処理の上限秒数（10〜50秒）")
    args = p.parse_args(argv)
    if not shutil.which("tesseract"):
        raise ValueError("Tesseractがインストールされていません")
    src, target = Path(args.image), Path(args.output)
    if target.exists():
        raise ValueError("既存のJSONを上書きしません。別のファイル名を指定してください")
    if not src.is_file() or src.stat().st_size > MAX_BYTES:
        raise ValueError("PNGファイルがありません、または10MBを超えています")
    data = src.read_bytes()
    if len(data) < 33:
        raise ValueError("PNGファイルが不正です")
    width, height = inspect_png(data)
    langs = subprocess.run(["tesseract", "--list-langs"], capture_output=True,
                           text=True, timeout=10, check=True).stdout
    # Some builds emit language listings on stderr.
    if args.lang not in (langs + "\n"):
        langs += subprocess.run(["tesseract", "--list-langs"], capture_output=True,
                                text=True, timeout=10).stderr
    if args.lang not in langs.split():
        raise ValueError("Tesseractの"+args.lang+"言語モデルが未インストールです")
    ver = subprocess.run(["tesseract", "--version"], capture_output=True, text=True, timeout=10)
    try:
        output = subprocess.run(["tesseract", str(src), "stdout", "-l", args.lang,
                                 "--psm", str(args.psm), "tsv"],
                                capture_output=True, text=True, timeout=args.timeout, check=True).stdout
    except subprocess.TimeoutExpired as exc:
        raise ValueError("OCRの処理時間が上限を超えました") from exc
    except subprocess.CalledProcessError as exc:
        raise ValueError("OCRに失敗しました。PNGとTesseractを確認してください") from exc
    items = parse_tsv(output, width, height, args.lang)
    record = build_record(str(src), data, width, height, args.lang, args.psm,
                          items, ver.stdout.splitlines()[0] if ver.stdout else "")
    serialized = json.dumps(record, ensure_ascii=False, indent=2) + "\n"
    # Exclusive creation prevents accidental overwriting even under races.
    with target.open("x", encoding="utf-8") as f:
        f.write(serialized)
    print(json.dumps({"created": str(target), "candidates": len(items),
                      "language": args.lang, "model": "local-tesseract",
                      "source_sha256": record["image"]["sha256"][:16]},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print("OCR失敗："+str(exc), file=sys.stderr)
        sys.exit(2)
