import struct
import unittest
import zlib
import tempfile
from pathlib import Path
from panel_output_gate import analyze_output

def make_png(w,h,with_grid=False):
    def chunk(name,data):
        return struct.pack('>I',len(data))+name+data+struct.pack('>I',zlib.crc32(name+data)&0xffffffff)
    rows=[]
    for y in range(h):
        row=bytearray()
        for x in range(w):
            white=with_grid and (abs(x-w//2)<3 or abs(y-h//3)<3 or abs(y-2*h//3)<3)
            row+=bytes(([255,255,255] if white else [101,88,77]))
        rows.append(b'\x00'+row)
    ihdr=struct.pack('>IIBBBBB',w,h,8,2,0,0,0)
    return (b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',ihdr)+
            chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b''))

class ImageOutputGateTests(unittest.TestCase):
    def check(self,data,expected):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'candidate.png'
            path.write_bytes(data)
            return analyze_output(path,expected)

    def test_six_panel_is_rejected_as_single(self):
        r=self.check(make_png(300,450,with_grid=True),'single_panel')
        self.assertEqual(r['status'],'BLOCKED')
        self.assertEqual(r['reason'],'PAGE_GRID_INSTEAD_OF_SINGLE_PANEL')

    def test_six_panel_is_not_auto_approved_as_page(self):
        r=self.check(make_png(300,450,with_grid=True),'page')
        self.assertEqual(r['status'],'REVIEW_REQUIRED')
        self.assertFalse(r['artApproved'])

    def test_single_panel_is_only_review_required(self):
        r=self.check(make_png(300,450,with_grid=False),'single_panel')
        self.assertEqual(r['status'],'REVIEW_REQUIRED')
        self.assertFalse(r['publicationApproved'])

    def test_single_panel_is_not_falsely_page_verified(self):
        r=self.check(make_png(300,450,with_grid=False),'page')
        self.assertEqual(r['status'],'BLOCKED')

    def test_corrupted_png_checksum_rejected(self):
        b=bytearray(make_png(300,450,True));b[30]^=0x12
        r=self.check(bytes(b),'single_panel')
        self.assertEqual(r['reason'],'PNG_CRC_INVALID')

    def test_unsupported_format_rejected(self):
        r=self.check(b'not a PNG','single_panel')
        self.assertEqual(r['status'],'BLOCKED')

    def test_tiny_real_single_does_not_claim_approval(self):
        r=self.check(make_png(16,20,False),'single_panel')
        self.assertEqual(r['status'],'REVIEW_REQUIRED')
        self.assertFalse(r['artApproved'])

if __name__=='__main__':unittest.main()
