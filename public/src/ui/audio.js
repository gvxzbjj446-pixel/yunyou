// 程序化配乐：五声音阶（宫商角徵羽）拨弦（Karplus-Strong 近似）+ 缓慢和声垫音 + 卷积混响。无需音频文件。
const PENTA = [0, 2, 4, 7, 9]; // C D E G A

export class Soundtrack {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.timer = null;
  }

  ensure() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // 程序生成的混响脉冲
    const len = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet).connect(this.master);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.6;
    this.dry.connect(this.master);
  }

  freq(semi, octave = 4) {
    return 261.63 * 2 ** ((semi + (octave - 4) * 12) / 12);
  }

  pad(semis, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.connect(lp);
    lp.connect(this.reverb);
    lp.connect(this.dry);
    for (const s of semis) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = this.freq(s, 3);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  pluck(semi, octave, t, vel = 0.5) {
    const ctx = this.ctx;
    const f = this.freq(semi, octave);
    // 噪声激励 + 高 Q 带通近似拨弦（古筝质感）
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.25, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 2.6);
    osc.connect(og);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 30;
    const ng = ctx.createGain();
    ng.gain.value = vel * 1.4;
    src.connect(bp).connect(ng);
    for (const n of [og, ng]) {
      n.connect(this.reverb);
      n.connect(this.dry);
    }
    osc.start(t);
    osc.stop(t + 2.8);
    src.start(t);
  }

  schedule() {
    const ctx = this.ctx;
    const chords = [
      [0, 4, 7, 14],
      [-3, 4, 9, 12],
      [-7, 0, 4, 9],
      [-5, 2, 7, 11],
    ];
    const bar = 4.8;
    let next = ctx.currentTime + 0.1;
    let i = 0;
    const tick = () => {
      if (!this.on) return;
      while (next < ctx.currentTime + 2) {
        const ch = chords[i % chords.length];
        this.pad(ch, next, bar + 1.2);
        // 每小节 5~7 个五声音阶音符，随机但有旋律走向
        let deg = Math.floor(Math.random() * 5);
        const notes = 5 + Math.floor(Math.random() * 3);
        for (let k = 0; k < notes; k++) {
          deg = Math.max(0, Math.min(9, deg + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
          const semi = PENTA[deg % 5] + (deg >= 5 ? 12 : 0);
          const tt = next + (k / notes) * bar + Math.random() * 0.12;
          this.pluck(semi, 4, tt, 0.35 + Math.random() * 0.4);
          if (Math.random() < 0.18) this.pluck(semi, 5, tt + 0.18, 0.2);
        }
        next += bar;
        i++;
      }
      this.timer = setTimeout(tick, 500);
    };
    tick();
  }

  async start() {
    this.ensure();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.on) return;
    this.on = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0.85, this.ctx.currentTime + 2.5);
    this.schedule();
  }

  stop() {
    if (!this.ctx || !this.on) return;
    this.on = false;
    clearTimeout(this.timer);
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.2);
  }

  toggle() {
    if (this.on) this.stop();
    else this.start();
    return this.on;
  }
}
