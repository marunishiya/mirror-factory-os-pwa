const test=require("node:test"),assert=require("node:assert/strict");
const hash=require("./sha256.js");
const crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const cases=[
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["The quick brown fox jumps over the lazy dog", "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"],
];
for(const [s,expected] of cases){
  test("SHA-256 standard vector "+(s||"(empty)"),async()=>{
    const input=new TextEncoder().encode(s);
    assert.equal(hash.pure(input),expected);
    assert.equal(await hash.sha256(input),expected);
  });
}
test("1MB binary input matches Node crypto",async()=>{
  const input=new Uint8Array(1024*1024);
  for(let i=0;i<input.length;i++)input[i]=(i*31+73)&255;
  const expected=crypto.createHash("sha256").update(input).digest("hex");
  assert.equal(hash.pure(input),expected);
  assert.equal(await hash.sha256(input.buffer),expected);
});
test("sha256 rejects unsupported input",async()=>{
  assert.throws(()=>hash.pure("abc"),/Uint8Array/);
  await assert.rejects(()=>hash.sha256("abc"),/入力形式/);
});
test("Portable builder packages both linked HTML files with embedded scripts",()=>{
  const exec=require("node:child_process").execFileSync;
  const result=JSON.parse(exec(process.execPath,[path.join(__dirname,"build-portable.cjs")],{encoding:"utf8"}));
  const out=path.join(__dirname,"portable-dist");
  assert(result.files.includes("index.html"));
  assert(result.files.includes("image-lab.html"));
  assert(result.files.includes("使い方.txt"));
  const index=fs.readFileSync(path.join(out,"index.html"),"utf8");
  const image=fs.readFileSync(path.join(out,"image-lab.html"),"utf8");
  assert(index.includes("ComicWorkbench"));
  for(const ref of ["ComicImageQA","ComicAuthority","ComicHash"]){
    assert(image.includes(ref),ref+" is not bundled");
  }
  assert(!/<script\s+src=/.test(index+image));
  assert(image.includes('id="sample"'));
  assert(image.includes('id="compose"'));
  assert(index.includes('href="./image-lab.html'));
});
