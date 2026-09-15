/**
 * GameAudio — Web Audio API synthesized sound effects for SomniaR Race.
 * No external audio files needed; all sounds are generated procedurally.
 */
export class GameAudio {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer;
  private muted = false;
  private unlockBound: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.35;
    this.masterGain.connect(this.ctx.destination);
    this.noiseBuffer = this.createNoise(1);

    // Mobile browsers require a user gesture to unlock AudioContext.
    // Install a one-shot listener that resumes on the first tap/click/keydown.
    this.unlockBound = this.unlock.bind(this);
    for (const evt of ["touchstart", "touchend", "click", "keydown"] as const) {
      document.addEventListener(evt, this.unlockBound, { capture: true, passive: true });
    }
  }

  /** Generate a white noise AudioBuffer of given duration (seconds). */
  private createNoise(duration: number): AudioBuffer {
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** Resume AudioContext if suspended (browsers require user gesture). */
  private resume() {
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  /** Unlock AudioContext from a user gesture — called automatically, can also be called manually. */
  unlock() {
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    // Remove listeners once unlocked
    if (this.unlockBound) {
      for (const evt of ["touchstart", "touchend", "click", "keydown"] as const) {
        document.removeEventListener(evt, this.unlockBound, { capture: true });
      }
      this.unlockBound = null;
    }
  }

  // ── Engine ──

  startEngine() {
    this.resume();
    if (this.engineOsc) return;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.06;
    this.engineGain.connect(this.masterGain);

    // Soft filtered noise — sounds like distant wind/road noise
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "triangle";
    this.engineOsc.frequency.value = 55;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 120;
    filter.Q.value = 0.5;
    this.engineFilter = filter;

    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineOsc.start();
  }

  stopEngine() {
    if (this.engineOsc) {
      this.engineOsc.stop();
      this.engineOsc.disconnect();
      this.engineOsc = null;
    }
    if (this.engineOsc2) {
      this.engineOsc2.stop();
      this.engineOsc2.disconnect();
      this.engineOsc2 = null;
    }
    if (this.engineFilter) {
      this.engineFilter.disconnect();
      this.engineFilter = null;
    }
    if (this.engineGain) {
      this.engineGain.disconnect();
      this.engineGain = null;
    }
  }

  /** Map speedMultiplier (0.3–1.1) — subtly shifts tone and volume. */
  setEngineSpeed(speed: number) {
    if (!this.engineOsc) return;
    const t = (speed - 0.3) / 0.8; // 0..1
    this.engineOsc.frequency.value = 55 + t * 35; // 55–90Hz
    if (this.engineFilter) this.engineFilter.frequency.value = 120 + t * 80;
    if (this.engineGain) this.engineGain.gain.value = 0.05 + t * 0.06; // 0.05–0.11
  }

  // ── One-shot effects ──

  playAccelerate() {
    this.resume();
    const t = this.ctx.currentTime;
    // Soft filtered noise whoosh — rising filter sweep
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1;
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.linearRampToValueAtTime(1200, t + 0.12);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.12);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(t);
    source.stop(t + 0.12);
  }

  playBrake() {
    this.resume();
    const t = this.ctx.currentTime;
    // Soft descending filtered noise whoosh
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1;
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.linearRampToValueAtTime(300, t + 0.15);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.15);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(t);
    source.stop(t + 0.15);
  }

  playLaneChange() {
    this.resume();
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2000;
    filter.Q.value = 2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.08);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start();
    source.stop(this.ctx.currentTime + 0.08);
  }

  playCrash() {
    this.resume();
    const t = this.ctx.currentTime;

    // Distorted noise burst
    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer;
    const distortion = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = (Math.PI + 200) * x / (Math.PI + 200 * Math.abs(x));
    }
    distortion.curve = curve;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.3, t);
    noiseGain.gain.linearRampToValueAtTime(0, t + 0.3);
    noiseSrc.connect(distortion);
    distortion.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noiseSrc.start(t);
    noiseSrc.stop(t + 0.3);

    // Low sine boom
    const boom = this.ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.value = 100;
    const boomGain = this.ctx.createGain();
    boomGain.gain.setValueAtTime(0.4, t);
    boomGain.gain.linearRampToValueAtTime(0, t + 0.4);
    boom.connect(boomGain);
    boomGain.connect(this.masterGain);
    boom.start(t);
    boom.stop(t + 0.4);
  }

  playCoinCollect() {
    this.resume();
    const t = this.ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      const start = t + i * 0.06;
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.linearRampToValueAtTime(0, start + 0.06);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.06);
    });
  }

  playBonusCollect() {
    this.resume();
    const t = this.ctx.currentTime;
    // C5=523, E5=659, G5=784
    [523, 659, 784].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      const start = t + i * 0.08;
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.linearRampToValueAtTime(0, start + 0.08);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.08);
    });
  }

  playKeyCollect() {
    this.resume();
    const t = this.ctx.currentTime;
    // Shimmering chord — multiple detuned sines
    [523, 530, 659, 665, 784, 790].forEach((freq) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.4);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  playSpeedBoost() {
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.linearRampToValueAtTime(800, t + 0.3);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.3);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  playGameOver() {
    this.resume();
    const t = this.ctx.currentTime;
    // G4=392, Eb4=311, C4=262
    [392, 311, 262].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      const start = t + i * 0.2;
      gain.gain.setValueAtTime(0.22, start);
      gain.gain.linearRampToValueAtTime(0, start + 0.2);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  }

  playRespawn() {
    this.resume();
    const t = this.ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      const start = t + i * 0.1;
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.linearRampToValueAtTime(0, start + 0.1);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.1);
    });
  }

  // ── Master volume ──

  mute() {
    this.muted = true;
    this.masterGain.gain.value = 0;
  }

  unmute() {
    this.muted = false;
    this.masterGain.gain.value = 0.35;
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    if (this.muted) this.unmute();
    else this.mute();
    return this.muted;
  }

  dispose() {
    this.stopEngine();
    // Clean up unlock listeners if still attached
    if (this.unlockBound) {
      for (const evt of ["touchstart", "touchend", "click", "keydown"] as const) {
        document.removeEventListener(evt, this.unlockBound, { capture: true });
      }
      this.unlockBound = null;
    }
    if (this.ctx.state !== "closed") {
      this.ctx.close();
    }
  }
}
