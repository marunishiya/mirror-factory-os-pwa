/* Offline SHA-256 (FIPS 180-4), with Web Crypto acceleration when available. */
(function(root,create){
  "use strict";
  const api=create();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.ComicHash=api;
})(typeof globalThis==="object"?globalThis:this,function(){
  "use strict";
  const K=[
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  const rotate=(x,n)=>(x>>>n)|(x<<(32-n));
  const hex=arr=>Array.from(arr,x=>x.toString(16).padStart(2,"0")).join("");
  function pure(bytes){
    if(!(bytes instanceof Uint8Array))throw Error("ハッシュ入力はUint8Arrayが必要です");
    const len=bytes.byteLength, size=Math.ceil((len+9)/64)*64, data=new Uint8Array(size);
    data.set(bytes);data[len]=0x80;
    const bits=BigInt(len)*8n;
    for(let i=0;i<8;i++)data[size-1-i]=Number((bits>>BigInt(i*8))&255n);
    const state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
      0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),w=new Uint32Array(64);
    for(let at=0;at<size;at+=64){
      for(let t=0;t<16;t++){const k=at+t*4;w[t]=(data[k]<<24)|(data[k+1]<<16)|(data[k+2]<<8)|data[k+3]}
      for(let t=16;t<64;t++){
        const a=w[t-15],b=w[t-2];
        const s0=rotate(a,7)^rotate(a,18)^(a>>>3);
        const s1=rotate(b,17)^rotate(b,19)^(b>>>10);
        w[t]=(w[t-16]+s0+w[t-7]+s1)>>>0;
      }
      let [a,b,c,d,e,f,g,h]=state;
      for(let t=0;t<64;t++){
        const s1=rotate(e,6)^rotate(e,11)^rotate(e,25);
        const choice=(e&f)^(~e&g);
        const temp1=(h+s1+choice+K[t]+w[t])>>>0;
        const s0=rotate(a,2)^rotate(a,13)^rotate(a,22);
        const majority=(a&b)^(a&c)^(b&c);
        const temp2=(s0+majority)>>>0;
        h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0;
      }
      [a,b,c,d,e,f,g,h].forEach((n,i)=>state[i]=(state[i]+n)>>>0);
    }
    const digest=new Uint8Array(32);
    state.forEach((v,i)=>{for(let j=0;j<4;j++)digest[4*i+j]=(v>>>(24-j*8))&255});
    return hex(digest);
  }
  async function sha256(data){
    const bytes=data instanceof Uint8Array?data:
      data instanceof ArrayBuffer?new Uint8Array(data):null;
    if(!bytes)throw Error("SHA-256入力形式が不正です");
    if(typeof crypto!=="undefined"&&crypto.subtle){
      try{return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))}catch(_){}
    }
    return pure(bytes);
  }
  return Object.freeze({sha256,pure});
});