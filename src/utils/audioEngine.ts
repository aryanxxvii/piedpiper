const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

type Note = {
  frequency: number;
  duration: number; // in beats
  velocity?: number;
  type?: OscillatorType;
};

type DrumPattern = {
  kick: number[];
  snare: number[];
  hihat: number[];
};

class AudioEngine {
  private isPlaying = false;
  private mainGainNode: GainNode;
  private bpm: number = 70;
  private notesScheduledUntil: number = 0;
  private lookahead: number = 0.1; // seconds
  private scheduleInterval: number = 0.025; // seconds
  private nextNoteTime: number = 0;
  private currentBeat: number = 0;
  private lowpassFilter: BiquadFilterNode;
  private reverbNode: ConvolverNode | null = null;
  private intervalId: number | null = null;
  private currentVolume: number = 0.4;
  private currentSeed: number = 0;

  constructor() {
    this.mainGainNode = audioContext.createGain();
    this.mainGainNode.gain.value = 0.4;
    
    this.lowpassFilter = audioContext.createBiquadFilter();
    this.lowpassFilter.type = "lowpass";
    this.lowpassFilter.frequency.value = 4000;
    this.lowpassFilter.Q.value = 1;
    
    this.mainGainNode.connect(this.lowpassFilter);
    this.lowpassFilter.connect(audioContext.destination);
    
    // Initialize reverb
    this.createReverb();
    
    // Initialize with a random seed based on current time
    this.currentSeed = Date.now() % 10000;
  }
  
  // Simple seeded random number generator
  private seededRandom(seed: number): () => number {
    let value = seed;
    return function() {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  }
  
  private async createReverb() {
    try {
      // Create a buffer for the impulse response
      const impulseLength = 2 * audioContext.sampleRate; // 2 seconds
      const impulse = audioContext.createBuffer(2, impulseLength, audioContext.sampleRate);
      
      // Fill the buffer with noise and create an envelope
      for (let channel = 0; channel < 2; channel++) {
        const impulseData = impulse.getChannelData(channel);
        for (let i = 0; i < impulseLength; i++) {
          // Noise with decay curve
          impulseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (impulseLength * 0.3));
        }
      }
      
      // Create convolver and set buffer
      this.reverbNode = audioContext.createConvolver();
      this.reverbNode.buffer = impulse;
      
      // Connect to audio path
      this.lowpassFilter.disconnect();
      this.lowpassFilter.connect(this.reverbNode);
      this.reverbNode.connect(audioContext.destination);
    } catch (error) {
      console.error("Failed to create reverb:", error);
    }
  }

  private scheduleNote(note: Note, time: number): void {
    // Create oscillator for the note
    const oscillator = audioContext.createOscillator();
    const noteGain = audioContext.createGain();
    
    // Configure oscillator
    oscillator.type = note.type || 'sine';
    oscillator.frequency.value = note.frequency;
    
    // Configure gain (envelope)
    noteGain.gain.value = note.velocity || 0.3;
    
    // Apply simple ADSR envelope
    const attackTime = 0.01;
    const decayTime = 0.1;
    const sustainLevel = 0.7;
    const releaseTime = 0.3;
    
    // Schedule the note timing
    const beatDuration = 60 / this.bpm;
    const noteDuration = note.duration * beatDuration;
    
    // Attack
    noteGain.gain.setValueAtTime(0, time);
    noteGain.gain.linearRampToValueAtTime(note.velocity || 0.3, time + attackTime);
    
    // Decay to sustain
    noteGain.gain.linearRampToValueAtTime((note.velocity || 0.3) * sustainLevel, 
                                           time + attackTime + decayTime);
    
    // Release
    noteGain.gain.linearRampToValueAtTime(0, 
                                          time + noteDuration - releaseTime);
    
    // Connect audio nodes
    oscillator.connect(noteGain);
    noteGain.connect(this.mainGainNode);
    
    // Start and stop the oscillator
    oscillator.start(time);
    oscillator.stop(time + noteDuration);
  }
  
  private scheduleDrum(type: 'kick' | 'snare' | 'hihat', time: number): void {
    if (type === 'kick') {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.frequency.value = 150;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.7, time);
      oscillator.frequency.exponentialRampToValueAtTime(40, time + 0.08);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      
      oscillator.connect(gainNode);
      gainNode.connect(this.mainGainNode);
      
      oscillator.start(time);
      oscillator.stop(time + 0.3);
    } else if (type === 'snare') {
      // White noise snare
      const bufferSize = audioContext.sampleRate * 0.1; // 100ms buffer
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noise = audioContext.createBufferSource();
      noise.buffer = buffer;
      
      // Bandpass filter for snare character
      const filter = audioContext.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.8;
      
      const gainNode = audioContext.createGain();
      gainNode.gain.setValueAtTime(0.3, time);
      gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
      
      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.mainGainNode);
      
      noise.start(time);
    } else if (type === 'hihat') {
      // White noise hihat
      const bufferSize = audioContext.sampleRate * 0.05; // 50ms buffer
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noise = audioContext.createBufferSource();
      noise.buffer = buffer;
      
      // Highpass filter for hihat character
      const filter = audioContext.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 7000;
      
      const gainNode = audioContext.createGain();
      gainNode.gain.setValueAtTime(0.1, time);
      gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
      
      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.mainGainNode);
      
      noise.start(time);
    }
  }
  
  private getRandomNote(scale: number[], rng: () => number): number {
    const baseNote = 220; // A3
    const noteIndex = Math.floor(rng() * scale.length);
    return baseNote * Math.pow(2, scale[noteIndex] / 12);
  }
  
  private generateMelodicPattern(rng: () => number): Note[] {
    // Use different scales for variety
    const scales = [
      [0, 2, 4, 7, 9, 12, 14], // A minor pentatonic
      [0, 2, 3, 5, 7, 8, 10, 12], // A natural minor
      [0, 2, 4, 5, 7, 9, 11, 12], // A major
      [0, 3, 5, 6, 7, 10, 12], // A blues
    ];
    
    const scale = scales[Math.floor(rng() * scales.length)];
    
    const pattern: Note[] = [];
    const patternLength = 16; // 16 beats pattern
    
    // Generate a simple melodic pattern with more variation
    for (let i = 0; i < patternLength; i++) {
      // Skip some beats for rhythm - more variation
      if (rng() < 0.5) continue;
      
      // Random note from scale
      const note = {
        frequency: this.getRandomNote(scale, rng),
        duration: rng() < 0.6 ? 1 : rng() < 0.8 ? 0.5 : 2, // varied durations
        velocity: 0.15 + rng() * 0.25, // random velocity
        type: (rng() < 0.6 ? 'sine' : rng() < 0.8 ? 'triangle' : 'sawtooth') as OscillatorType
      };
      
      pattern.push(note);
    }
    
    return pattern;
  }
  
  private generateDrumPattern(rng: () => number): DrumPattern {
    const pattern: DrumPattern = {
      kick: new Array(16).fill(0),
      snare: new Array(16).fill(0),
      hihat: new Array(16).fill(0)
    };
    
    // More varied kick patterns
    const kickPatterns = [
      [0, 8], // basic
      [0, 4, 8, 12], // four on floor
      [0, 6, 8, 14], // syncopated
      [0, 8, 10], // with extra hit
    ];
    
    const kickPattern = kickPatterns[Math.floor(rng() * kickPatterns.length)];
    kickPattern.forEach(beat => pattern.kick[beat] = 1);
    
    // Varied snare patterns
    const snarePatterns = [
      [4, 12], // basic backbeat
      [4, 8, 12], // with middle hit
      [4, 10, 12], // syncopated
      [2, 6, 10, 14], // complex
    ];
    
    const snarePattern = snarePatterns[Math.floor(rng() * snarePatterns.length)];
    snarePattern.forEach(beat => pattern.snare[beat] = 1);
    
    // More varied hihat patterns
    for (let i = 0; i < 16; i++) {
      // Different hihat patterns for variety
      if (rng() < 0.7) {
        pattern.hihat[i] = 1;
      }
    }
    
    return pattern;
  }
  
  private generateChordProgression(rng: () => number) {
    // Different chord progressions for variety
    const progressions = [
      // Am - Dm - Em - Am
      [
        { root: 220, intervals: [0, 3, 7] },
        { root: 293.66, intervals: [0, 3, 7] },
        { root: 329.63, intervals: [0, 3, 7] },
        { root: 220, intervals: [0, 3, 7] }
      ],
      // Am - F - C - G
      [
        { root: 220, intervals: [0, 3, 7] },
        { root: 174.61, intervals: [0, 4, 7] },
        { root: 261.63, intervals: [0, 4, 7] },
        { root: 196, intervals: [0, 4, 7] }
      ],
      // Dm - Am - Bb - F
      [
        { root: 293.66, intervals: [0, 3, 7] },
        { root: 220, intervals: [0, 3, 7] },
        { root: 233.08, intervals: [0, 4, 7] },
        { root: 174.61, intervals: [0, 4, 7] }
      ]
    ];
    
    return progressions[Math.floor(rng() * progressions.length)];
  }
  
  private scheduleChord(chord: { root: number, intervals: number[] }, time: number, duration: number) {
    chord.intervals.forEach(interval => {
      const frequency = chord.root * Math.pow(2, interval / 12);
      const note: Note = {
        frequency,
        duration,
        velocity: 0.1,
        type: 'sine'
      };
      this.scheduleNote(note, time);
    });
  }
  
  private scheduler() {
    // Schedule notes ahead while we're still playing
    while (this.nextNoteTime < audioContext.currentTime + this.lookahead && this.isPlaying) {
      this.scheduleNextNotes();
      this.advanceNote();
    }
  }
  
  private scheduleNextNotes() {
    const beatDuration = 60 / this.bpm;
    const barLength = 16; // 16 beats per pattern
    
    // Get current beat within the pattern (0-15)
    const patternBeat = this.currentBeat % barLength;
    
    // If we're at the start of a new pattern, generate new patterns
    if (patternBeat === 0 && this.currentBeat > 0) {
      this.generateNewPatterns();
    }
    
    // Schedule chord if it's a chord beat (every 4 beats)
    if (patternBeat % 4 === 0) {
      const chordIndex = (patternBeat / 4) % this.chordProgression.length;
      this.scheduleChord(
        this.chordProgression[chordIndex], 
        this.nextNoteTime, 
        beatDuration * 4
      );
    }
    
    // Schedule drum sounds for this beat
    if (this.drumPattern.kick[patternBeat]) {
      this.scheduleDrum('kick', this.nextNoteTime);
    }
    
    if (this.drumPattern.snare[patternBeat]) {
      this.scheduleDrum('snare', this.nextNoteTime);
    }
    
    if (this.drumPattern.hihat[patternBeat]) {
      this.scheduleDrum('hihat', this.nextNoteTime);
    }
    
    // Schedule melodic notes
    for (let note of this.melodicPattern) {
      const noteDuration = note.duration * beatDuration;
      const noteEndTime = patternBeat * beatDuration + noteDuration;
      
      if (patternBeat * beatDuration <= noteEndTime && 
          (patternBeat + 1) * beatDuration > noteEndTime) {
        this.scheduleNote(note, this.nextNoteTime);
      }
    }
  }
  
  private advanceNote() {
    // Duration between beats
    const secondsPerBeat = 60.0 / this.bpm;
    
    // Advance time by a beat
    this.nextNoteTime += secondsPerBeat;
    
    // Advance beat counter
    this.currentBeat++;
  }
  
  // Properties for pattern generation
  private melodicPattern: Note[] = [];
  private drumPattern: DrumPattern = { kick: [], snare: [], hihat: [] };
  private chordProgression: { root: number, intervals: number[] }[] = [];
  
  public generateNewPatterns(): void {
    // Use the current seed to generate patterns
    const rng = this.seededRandom(this.currentSeed);
    
    // Generate fresh patterns each time using seeded random
    this.chordProgression = this.generateChordProgression(rng);
    this.melodicPattern = this.generateMelodicPattern(rng);
    this.drumPattern = this.generateDrumPattern(rng);
    this.currentBeat = 0;
  }

  public setSeed(seed: number): void {
    this.currentSeed = seed;
  }

  public getSeed(): number {
    return this.currentSeed;
  }

  public async start(): Promise<void> {
    if (this.isPlaying) return;
    
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    
    // Initialize generator
    this.isPlaying = true;
    this.nextNoteTime = audioContext.currentTime;
    
    // Generate initial patterns
    this.generateNewPatterns();
    
    // Start scheduler
    this.intervalId = window.setInterval(() => this.scheduler(), this.scheduleInterval * 1000);
  }
  
  public stop(): void {
    this.isPlaying = false;
    
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  public setVolume(volume: number): void {
    this.currentVolume = volume;
    this.mainGainNode.gain.value = volume;
  }

  public getVolume(): number {
    return this.currentVolume;
  }
  
  public setBPM(bpm: number): void {
    this.bpm = Math.max(60, Math.min(120, bpm));
  }
  
  public toggleFilter(active: boolean): void {
    if (active) {
      this.lowpassFilter.frequency.value = 1200;
    } else {
      this.lowpassFilter.frequency.value = 20000;
    }
  }
  
  // Returns current playback state
  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
  
  // For cleaning up when component unmounts
  public cleanup(): void {
    this.stop();
  }
}

// Export a singleton instance
const audioEngine = new AudioEngine();
export default audioEngine;
