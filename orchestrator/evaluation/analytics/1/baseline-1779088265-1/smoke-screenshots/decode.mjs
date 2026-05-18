import { writeFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const [inFile, outFile] = args;
const b64 = readFileSync(inFile, 'utf8').trim();
const data = b64.startsWith('data:') ? b64.split(',')[1] : b64;
writeFileSync(outFile, Buffer.from(data, 'base64'));
console.log('wrote', outFile);
