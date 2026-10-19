#!/usr/bin/env python3
"""No Tesseract dependency required: deterministic CLI parser boundary tests."""
import importlib.util
import io
import json
from pathlib import Path
import struct
import unittest
import zlib

module_path = Path(__file__).with_name("ocr_sidecar.py")
spec = importlib.util.spec_from_file_location("comic_ocr_sidecar", module_path)
ocr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ocr)

HEADER = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
ROWS = (
    "5\t1\t1\t1\t1\t1\t100\t40\t40\t35\t88.5\t責任者を\n"
    "5\t1\t1\t1\t1\t2\t141\t40\t140\t35\t92.0\t呼んでください。\n"
    "5\t1\t1\t1\t2\t1\t100\t90\t100\t32\t71.4\t別の行\n"
)


def tiny_png(w, h):
    def chunk(name, data):
        payload = name + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload))
    pixels = b"".join(b"\x00" + b"\xff\xff\xff" * w for _ in range(h))
    header = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return ocr.PNG_MAGIC + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


class SidecarTests(unittest.TestCase):
    def test_dimensions_and_hash(self):
        raw = tiny_png(20, 10)
        self.assertEqual(ocr.inspect_png(raw), (20, 10))
        data = ocr.build_record("synthetic.png", raw, 20, 10, "jpn", 6, [], "tesseract 5")
        self.assertEqual(data["schema"], ocr.SCHEMA)
        self.assertEqual(data["image"]["bytes"], len(raw))
        self.assertFalse(data["safety"]["automaticallyVerified"])
        self.assertFalse(data["safety"]["canonApproved"])
        self.assertNotIn("imageBytes", json.dumps(data))

    def test_png_validation(self):
        with self.assertRaises(ValueError): ocr.inspect_png(b"not png")
        with self.assertRaises(ValueError): ocr.inspect_png(tiny_png(2500, 2000))

    def test_tsv_groups_by_line_and_preserves_candidate_text(self):
        candidates = ocr.parse_tsv(HEADER + ROWS, 740, 340, "jpn")
        self.assertEqual(len(candidates), 2)
        self.assertEqual(candidates[0]["text"], "責任者を呼んでください。")
        self.assertAlmostEqual(candidates[0]["confidence"], 90.25)
        self.assertAlmostEqual(candidates[0]["bounds"]["x"], 100/740, places=5)

    def test_vertical_and_empty_are_cautious(self):
        self.assertEqual(ocr.parse_tsv(HEADER, 740, 340, "jpn_vert"), [])
        with self.assertRaises(ValueError):
            ocr.parse_tsv(HEADER + ROWS, 740, 340, "unknown")

    def test_tsv_bad_header_is_rejected(self):
        with self.assertRaises(ValueError):
            ocr.parse_tsv("col\nx\n", 740, 340, "jpn")

    def test_bad_coordinates_and_confidence_are_skipped(self):
        src = HEADER + "5\t1\t1\t1\t1\t1\t900\t5\t200\t20\t80\toutside\n" + (
            "5\t1\t1\t1\t2\t1\t100\t40\t200\t20\t-1\twrong\n")
        self.assertEqual(ocr.parse_tsv(src, 740, 340, "jpn"), [])


if __name__ == "__main__":
    unittest.main()
