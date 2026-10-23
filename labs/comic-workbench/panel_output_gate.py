#!/usr/bin/env python3
"""Fail-closed PNG layout gate: prevent a 2x3 page being accepted as one panel.
Standard library only. No OCR, face recognition, network, or Canon writes.
"""
import argparse
import hashlib
import json
import struct
import zlib
from pathlib import Path

PNG_MAGIC=b'\x89PNG\r\n\x1a\n'
class Rejected(Exception):
    pass

def read_png_rgb(path):
    path=Path(path)
    if not path.is_file() or path.stat().st_size>24_000_000:
        raise Rejected('IMAGE_MISSING_OR_TOO_LARGE')
    original=path.read_bytes()
    if not original.startswith(PNG_MAGIC):
        raise Rejected('ONLY_PNG_SUPPORTED')
    offset=8; chunks=[]; w=h=channels=None; found_end=False
    while offset+12<=len(original):
        size=struct.unpack_from('>I',original,offset)[0]
        if size>24_000_000 or offset+12+size>len(original):
            raise Rejected('PNG_CHUNK_INVALID')
        kind=original[offset+4:offset+8]
        data=original[offset+8:offset+8+size]
        expected=struct.unpack_from('>I',original,offset+8+size)[0]
        if zlib.crc32(kind+data)&0xffffffff!=expected:
            raise Rejected('PNG_CRC_INVALID')
        offset+=12+size
        if kind==b'IHDR':
            if w is not None or size!=13:
                raise Rejected('PNG_IHDR_INVALID')
            w,h,depth,colour,comp,filt,inter=struct.unpack('>IIBBBBB',data)
            if depth!=8 or colour not in (2,6) or comp or filt or inter:
                raise Rejected('PNG_FORMAT_UNSUPPORTED')
            channels=3 if colour==2 else 4
            if not w or not h or w*h>8_000_000 or w>8192 or h>8192:
                raise Rejected('PNG_DIMENSIONS_UNSAFE')
        elif kind==b'IDAT':
            chunks.append(data)
        elif kind==b'IEND':
            found_end=True
            break
    if not found_end or w is None or not chunks:
        raise Rejected('PNG_INCOMPLETE')
    stride=w*channels
    required=h*(stride+1)
    if required>36_000_000:
        raise Rejected('PNG_DECOMPRESSED_TOO_LARGE')
    try:
        d=zlib.decompressobj()
        raw=d.decompress(b''.join(chunks),required+1)
        if len(raw)!=required or not d.eof:
            raise Rejected('PNG_SCANLINES_INVALID')
    except (zlib.error,ValueError,OverflowError) as e:
        raise Rejected('PNG_ZLIB_INVALID') from e
    out=bytearray(h*stride); prev=bytearray(stride); off=0
    for y in range(h):
        filter_method=raw[off];off+=1
        row=bytearray(raw[off:off+stride]);off+=stride
        if filter_method not in (0,1,2,3,4):
            raise Rejected('PNG_FILTER_UNSUPPORTED')
        for x in range(stride):
            a=row[x-channels] if x>=channels else 0
            b=prev[x]
            c=prev[x-channels] if x>=channels else 0
            if filter_method==1: val=a
            elif filter_method==2: val=b
            elif filter_method==3: val=(a+b)//2
            elif filter_method==4:
                p=a+b-c;pa=abs(p-a);pb=abs(p-b);pc=abs(p-c)
                val=a if pa<=pb and pa<=pc else (b if pb<=pc else c)
            else: val=0
            row[x]=(row[x]+val)&255
        out[y*stride:(y+1)*stride]=row
        prev=row
    return w,h,channels,out,hashlib.sha256(original).hexdigest()

def group_runs(items,limit_gap=1):
    runs=[]
    for y in items:
        if not runs or y>runs[-1][-1]+limit_gap:
            runs.append([y,y])
        else:runs[-1][1]=y
    return runs

def analyze_output(path,expected='single_panel'):
    report={'source':Path(path).name,'expected':expected,
            'artApproved':False,'canonApproved':False,'publicationApproved':False}
    try:
        w,h,c,data,sha=read_png_rgb(path)
        report.update({'width':w,'height':h,'sha256':sha})
        row_candidates=[]
        xs=range(max(2,int(.02*w)),int(.98*w),max(1,w//256))
        for y in range(int(.12*h),int(.88*h)):
            bright=0;total=0
            for x in xs:
                i=(y*w+x)*c
                bright+=(data[i]>210 and data[i+1]>210 and data[i+2]>210)
                total+=1
            if bright/max(1,total)>.82:
                row_candidates.append(y)
        separator_bands=[(a,b) for a,b in group_runs(row_candidates) if b-a>=2]
        x=w//2;bright=0;total=0
        for y in range(int(.08*h),int(.97*h),max(1,h//512)):
            i=(y*w+x)*c
            bright+=int(data[i]>210 and data[i+1]>210 and data[i+2]>210)
            total+=1
        central_brightness=bright/max(1,total)
        two_rows=(len(separator_bands)>=2 and
            any(abs(b[0]-a[0])>.15*h for i,a in enumerate(separator_bands)
                for b in separator_bands[i+1:]))
        page_grid=two_rows and central_brightness>.72
        report.update({'horizontal_separator_bands':separator_bands[:8],
            'central_gutter_white_ratio':round(central_brightness,3),
            'two_by_three_grid_detected':page_grid})
        if expected=='single_panel' and page_grid:
            report.update(status='BLOCKED',reason='PAGE_GRID_INSTEAD_OF_SINGLE_PANEL')
        elif expected=='single_panel' and not page_grid:
            report.update(status='REVIEW_REQUIRED',reason='NO_DEFINITE_GRID_BUT_VISUAL_REVIEW_REQUIRED')
        elif expected=='page' and page_grid:
            report.update(status='REVIEW_REQUIRED',reason='GRID_DETECTED_BUT_SCRIPT_QA_REQUIRED')
        else:
            report.update(status='BLOCKED',reason='PAGE_LAYOUT_NOT_CONFIRMED')
    except Rejected as e:
        report.update(status='BLOCKED',reason=str(e))
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument('png')
    p.add_argument('--expected',choices=['single_panel','page'],default='single_panel')
    p.add_argument('--report',default=None)
    args=p.parse_args()
    report=analyze_output(args.png,args.expected)
    out=json.dumps(report,ensure_ascii=False,indent=2)
    if args.report:Path(args.report).write_text(out+'\n',encoding='utf8')
    print(out)
    raise SystemExit(2 if report['status']=='BLOCKED' else 0)

if __name__=='__main__':main()
