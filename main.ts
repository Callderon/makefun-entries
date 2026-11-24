// tiny-stack-vm: faithful interpreter for make.fun's tiny stack ISA
// (kit ISA.md; vm.mjs rules). Hard rules done right: imul wrapping MUL,
// unsigned DIVU/MODU/LTU, 5-bit shift counts, PUSH8 sign extension,
// INT_MIN/-1, remainder sign, distinct trap codes 2-11, stack/call/memory
// bounds, step/output limits, fall-off-end = trap 9.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; len: number; code: number } {
  const D = new Int32Array(256);
  const C = new Int32Array(64);
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  const n = p.length;
  let sp = 0;
  let csp = 0;
  let pc = 0;
  let ip = 0;
  let olen = 0;
  let steps = 0;
  const done = (code: number): { out: Uint8Array; len: number; code: number } => ({ out, len: olen, code });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = p[pc];
    // Immediate size, pops and pushes per opcode; an unknown byte traps 5
    // before any immediate is read.
    let imm = 0;
    let pops = 0;
    let push = 0;
    switch (op) {
      case 0x00:
      case 0x34:
        break;
      case 0x01:
        imm = 1;
        push = 1;
        break;
      case 0x02:
        imm = 4;
        push = 1;
        break;
      case 0x03:
      case 0x50:
      case 0x51:
      case 0x53:
        pops = 1;
        break;
      case 0x04:
        pops = 1;
        push = 2;
        break;
      case 0x05:
        pops = 2;
        push = 2;
        break;
      case 0x06:
        pops = 2;
        push = 3;
        break;
      case 0x07:
        pops = 3;
        push = 3;
        break;
      case 0x17:
      case 0x1b:
      case 0x40:
        pops = 1;
        push = 1;
        break;
      case 0x30:
        imm = 2;
        break;
      case 0x31:
      case 0x32:
        imm = 2;
        pops = 1;
        break;
      case 0x33:
        imm = 2;
        break;
      case 0x41:
        pops = 2;
        break;
      case 0x52:
        push = 1;
        break;
      default:
        if ((op >= 0x10 && op <= 0x1e) || (op >= 0x20 && op <= 0x22)) {
          pops = 2;
          push = 1;
        } else {
          return done(5);
        }
    }
    if (pc + imm >= n) return done(9);
    steps++;
    if (sp < pops) return done(2);
    if (sp - pops + push > 256) return done(3);
    const next = pc + 1 + imm;
    pc = next;
    switch (op) {
      case 0x00:
        return done(0);
      case 0x01:
        D[sp++] = (p[next - 1] << 24) >> 24;
        break;
      case 0x02:
        D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 0x05: {
        const t = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = t;
        break;
      }
      case 0x06:
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 0x07: {
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 0x17:
        D[sp - 1] = -D[sp - 1] | 0;
        break;
      case 0x1b:
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = op === 0x30;
        if (op !== 0x30) {
          const v = D[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (csp === 64) return done(7);
        C[csp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1];
        const v = D[sp - 2];
        if (addr < 0 || addr >= 256) return done(6);
        sp -= 2;
        M[addr] = v;
        break;
      }
      case 0x50: {
        const s = String(D[sp - 1]);
        if (olen + s.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return done(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
        return done(D[--sp] & 255);
      default: {
        // Binary operators 0x10-0x1e and 0x20-0x22 (0x17/0x1b handled above).
        const b = D[sp - 1];
        const a = D[sp - 2];
        let r: number;
        switch (op) {
          case 0x10:
            r = (a + b) | 0;
            break;
          case 0x11:
            r = (a - b) | 0;
            break;
          case 0x12:
            r = Math.imul(a, b);
            break;
          case 0x13:
            if (b === 0) return done(4);
            r = a === -2147483648 && b === -1 ? a : Math.trunc(a / b) | 0;
            break;
          case 0x14:
            if (b === 0) return done(4);
            r = b === -1 ? 0 : a % b | 0;
            break;
          case 0x15:
            if (b === 0) return done(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16:
            if (b === 0) return done(4);
            r = (a >>> 0) % (b >>> 0) | 0;
            break;
          case 0x18:
            r = a & b;
            break;
          case 0x19:
            r = a | b;
            break;
          case 0x1a:
            r = a ^ b;
            break;
          case 0x1c:
            r = a << (b & 31);
            break;
          case 0x1d:
            r = a >> (b & 31);
            break;
          case 0x1e:
            r = (a >>> (b & 31)) | 0;
            break;
          case 0x20:
            r = a === b ? 1 : 0;
            break;
          case 0x21:
            r = a < b ? 1 : 0;
            break;
          default:
            r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        }
        D[sp - 2] = r;
        sp--;
        break;
      }
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(
    new Uint8Array(readFileSync(join(I, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(I, id, 'input.bin'))),
  );
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out.subarray(0, r.len));
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
