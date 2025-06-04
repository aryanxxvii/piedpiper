// src/utils/audioEngine.ts

// Helper to convert semitones to frequency multiplier (can be outside class or static)
const semitoneToRatio = (semitones: number): number => Math.pow(2, semitones / 12);

// Forward declaration for window.webkitAudioContext
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

type Note = { // Basic Note definition, will be expanded later
  frequency: number;
  duration: number; 
  velocity?: number;
  instrument?: string; 
  attack?: number;
  release?: number;
  // For scheduling precise timings
  targetBeatInBar?: number; 
  target16thStep?: number;
};

class AudioEngine {
  private audioContext: AudioContext;
  private mainGainNode: GainNode;

  public isPlaying: boolean = false;
  private currentSeed: number = 0;
  public bpm: number = 70; // Default BPM

  // Scheduler properties - will be initialized in start()
  private lookahead: number = 0.1; // (seconds) How far ahead to schedule audio events
  private scheduleInterval: number = 0.025; // (seconds) How often scheduler runs
  private nextNoteTime: number = 0; // When the next note is due
  private current16thStepInBar: number = 0;
  private intervalId: number | null = null;

  // Global Effects Nodes
  private lowpassFilter!: BiquadFilterNode; 
  private reverbNode: ConvolverNode | null = null;
  private dryGain!: GainNode;
  private wetGain!: GainNode;
  private delayNode!: DelayNode; 
  private feedbackNode!: GainNode;
  private delayFilterNode!: BiquadFilterNode;

  // Static definitions for harmonic content generation
  private static SCALES = [
    { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
    { name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
    { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
    { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
    { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  ];

  private static ROOT_NOTES_HZ = [ // Base frequencies for keys
    110.00, // A2
    123.47, // B2
    130.81, // C3
    146.83, // D3
    164.81, // E3
    174.61, // F3
    196.00  // G3
  ];

  private static PROGRESSION_TEMPLATES = [ // Using scale degrees (0-indexed)
    [0, 3, 4, 0],    // I-IV-V-I
    [0, 5, 3, 4],    // I-vi-IV-V 
    [1, 4, 0],       // ii-V-I
    [0, 1, 3, 4],    // I-ii-IV-V
    [5, 1, 3, 0],    // vi-ii-IV-I
  ];

  // Instance properties for harmonic content
  private keyRootFreq: number = 220; // Default A3, will be overridden
  private scale: number[] = []; // e.g. [0, 2, 4, 5, 7, 9, 11] for major
  private prevPadFrequencies: number[] = []; // For voice leading for pads
  private currentScaleNotes: number[] = []; // MIDI notes in current scale
  private progressionTemplate: number[] = [];
  private progressionIndex: number = 0;
  private currentScaleDegree: number = 0;
  private currentChord: {
    rootFreq: number;
    intervals: number[];
    absoluteSemitones: number[];
  } | null = null;
  private barCount: number = 0;

  // Placeholders for instrument note arrays
  private currentPadNotes: Note[] = [];
  private currentBassNote: Note | null = null;
  private currentAtmosphereNote: Note | null = null; 
  private atmosphereNextChangeBar: number = 0;
  private currentElectricPianoNotes: Note[] = []; 
  private currentFluteNotes: Note[] = []; 

  // Chord Voicings
  private static CHORD_VOICINGS = {
    triadMaj: [0,4,7], triadMin: [0,3,7], dimTriad: [0,3,6], augTriad: [0,4,8],
    sus4Triad: [0,5,7],
    maj7: [0,4,7,11], min7: [0,3,7,10], dom7: [0,4,7,10],
    minMaj7: [0,3,7,11], dim7: [0,3,6,9], m7b5: [0,3,6,10],
    dom7sus4: [0,5,7,10],
    maj6: [0,4,7,9], min6: [0,3,7,9],
    maj9: [0,4,7,11,14], min9: [0,3,7,10,14], dom9: [0,4,7,10,14],
    add9: [0,4,7,14], minAdd9: [0,3,7,14],
    // Optional sparse voicings
    // maj7no5: [0,4,11],
    // min7no5: [0,3,10],
     };

  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.mainGainNode = this.audioContext.createGain();
    this.mainGainNode.gain.value = 0.35; // Default volume
    // this.mainGainNode.connect(this.audioContext.destination); // Will be connected via effects chain

    // Master Lowpass Filter
    this.lowpassFilter = this.audioContext.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.frequency.value = 20000; 
    this.lowpassFilter.Q.value = 0.7;

    // Reverb Send/Return Path
    this.dryGain = this.audioContext.createGain();
    this.wetGain = this.audioContext.createGain();
    this.dryGain.gain.value = 0.7; 
    this.wetGain.gain.value = 0.3;

    // Delay Path (Simple Echo)
    this.delayNode = this.audioContext.createDelay(2.0); 
    this.feedbackNode = this.audioContext.createGain();
    this.delayFilterNode = this.audioContext.createBiquadFilter(); 
    this.delayFilterNode.type = 'lowpass';
    this.delayFilterNode.frequency.value = 1500;
    this.delayNode.delayTime.value = (60 / this.bpm) * 0.50; 
    this.feedbackNode.gain.value = 0.35; 

    // Connections:
    this.mainGainNode.connect(this.lowpassFilter);

    this.lowpassFilter.connect(this.dryGain);
    this.dryGain.connect(this.audioContext.destination);

    this.lowpassFilter.connect(this.delayNode);
    this.delayNode.connect(this.delayFilterNode);
    this.delayFilterNode.connect(this.feedbackNode);
    this.feedbackNode.connect(this.delayNode); 

    this.delayFilterNode.connect(this.wetGain); 
    
    this.wetGain.connect(this.audioContext.destination);

    this.createReverbAndConnect(); 

    this.currentSeed = Date.now() % 100000; 
    console.log("AudioEngine initialized with effects chain");
  }

  private async createReverbAndConnect(): Promise<void> {
    try {
      const impulseLength = this.audioContext.sampleRate * 2.0; 
      const impulse = this.audioContext.createBuffer(2, impulseLength, this.audioContext.sampleRate);
      const rng = Math.random; 

      for (let channel = 0; channel < 2; channel++) {
        const impulseData = impulse.getChannelData(channel);
        for (let i = 0; i < impulseLength; i++) {
          impulseData[i] = (rng() * 2 - 1) * Math.pow(1 - i / impulseLength, 1.8); 
        }
      }
      this.reverbNode = this.audioContext.createConvolver();
      this.reverbNode.buffer = impulse;
      console.log("Reverb created successfully.");

      this.lowpassFilter.connect(this.reverbNode); 
      this.reverbNode.connect(this.wetGain); 

    } catch (error) {
      console.error("Failed to create reverb:", error);
      this.reverbNode = null;
    }
  }

  public seededRandom(seedIncrement: number = 0): () => number {
    let value = this.currentSeed + seedIncrement;
    return function() {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280.0;
    };
  }

  public setSeed(seed: number): void {
    this.currentSeed = seed;
    console.log(`Seed set to: ${seed}`);
    if (this.isPlaying) {
      this.stop();
      // Consider a slight delay if stop has async aspects, though current stop is synchronous
      this.start(); 
    } else {
      // If not playing, prime patterns for next start (though generateNewPatterns is a stub)
      this.generateNewPatterns();
    }
  }

  public getSeed(): number {
    return this.currentSeed;
  }

  public setVolume(volume: number): void {
    const newVolume = Math.max(0, Math.min(1, volume));
    this.mainGainNode.gain.setValueAtTime(newVolume, this.audioContext.currentTime);
    // Could store this.currentVolume if needed for other purposes
    console.log(`Volume set to: ${newVolume}`);
  }
  
  public getVolume(): number {
      return this.mainGainNode.gain.value;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  // --- Stubs for future implementation ---
  private getNotesInScale(rootNoteFrequency: number, scaleIntervals: number[]): number[] {
    const notes = new Set<number>();
    const minMidiNote = 24; // C1
    const maxMidiNote = 96; // C7 (ensures reasonable frequency range)

    const rootMidi = 69 + 12 * Math.log2(rootNoteFrequency / 440);

    for (let octaveOffset = -2; octaveOffset <= 3; octaveOffset++) { // Cover a good range
      for (const interval of scaleIntervals) {
        const note = Math.round(rootMidi + interval + (12 * octaveOffset));
        if (note >= minMidiNote && note <= maxMidiNote) {
          notes.add(note);
        }
      }
    }
    return Array.from(notes).sort((a, b) => a - b);
  }

  private voiceLeadPads(targetChordFreqs: number[], prevChordFreqs: number[]): number[] {
    if (prevChordFreqs.length === 0 || targetChordFreqs.length === 0) {
      return targetChordFreqs.sort((a, b) => a - b);
    }
    // Simplified: just sort the target chord notes for now.
    return targetChordFreqs.sort((a, b) => a - b);
  }

  private getDiatonicChordVoicing(scaleDegree: number, keyScaleIntervals: number[], rng: () => number): number[] {
    const numScaleNotes = keyScaleIntervals.length;
    if (numScaleNotes === 0) return AudioEngine.CHORD_VOICINGS.triadMaj; // Fallback

    const getIntervalInScale = (degree: number): number => keyScaleIntervals[degree % numScaleNotes];

    const chordRootOffsetInKey = getIntervalInScale(scaleDegree);

    const calculateInterval = (offset: number): number => {
      const noteInKey = getIntervalInScale(scaleDegree + offset);
      let interval = noteInKey - chordRootOffsetInKey;
      while (interval < 0) interval += 12;
      return interval % 12;
    };

    const thirdInterval = calculateInterval(2); // 3rd is 2 scale steps up
    const fifthInterval = calculateInterval(4); // 5th is 4 scale steps up
    const seventhInterval = calculateInterval(6); // 7th is 6 scale steps up

    // Determine quality based on 3rd, 5th, and 7th
    let quality: 'maj7' | 'min7' | 'dom7' | 'triadMaj' | 'triadMin' | 'other' = 'other';

    if (thirdInterval === 4) { // Major-type third
      if (fifthInterval === 7) { // Perfect fifth
        if (seventhInterval === 11) quality = 'maj7';
        else if (seventhInterval === 10) quality = 'dom7';
        else quality = 'triadMaj'; // Default to major triad if 7th is not standard maj7/dom7
      } else { // Augmented or other fifth with major third
        quality = 'triadMaj'; // Fallback to major triad for now for things like aug
      }
    } else if (thirdInterval === 3) { // Minor-type third
      if (fifthInterval === 7) { // Perfect fifth
        if (seventhInterval === 10) quality = 'min7';
        else quality = 'triadMin'; // Default to minor triad
      } else if (fifthInterval === 6) { // Diminished fifth
        quality = 'triadMin'; // Fallback to minor triad (representing diminished triad [0,3,6])
      } else {
        quality = 'triadMin'; // Fallback for other minor-ish
      }
    } else {
       if (fifthInterval === 7) quality = 'triadMaj'; 
       else quality = 'triadMin'; 
    }
    
    const playSeventh = rng() < 0.7; 

    switch (quality) {
      case 'maj7':
        return playSeventh ? AudioEngine.CHORD_VOICINGS.maj7 : AudioEngine.CHORD_VOICINGS.triadMaj;
      case 'min7':
        return playSeventh ? AudioEngine.CHORD_VOICINGS.min7 : AudioEngine.CHORD_VOICINGS.triadMin;
      case 'dom7':
        return playSeventh ? AudioEngine.CHORD_VOICINGS.dom7 : AudioEngine.CHORD_VOICINGS.triadMaj;
      case 'triadMaj':
        return AudioEngine.CHORD_VOICINGS.triadMaj;
      case 'triadMin':
        if (thirdInterval === 3 && fifthInterval === 6) return [0, 3, 6]; 
        return AudioEngine.CHORD_VOICINGS.triadMin;
      default: 
        if (thirdInterval === 4 && fifthInterval === 8) return [0,4,8]; 
        return AudioEngine.CHORD_VOICINGS.triadMaj; 
    }
  }

  private generateNewPatterns(): void {
    const rng = this.seededRandom(); 
    
    // BPM randomization
    const rngBpm = this.seededRandom(this.currentSeed + 100); 
    this.bpm = Math.floor(rngBpm() * 30) + 60; // e.g., 60-89 BPM
    console.log(`BPM set to: ${this.bpm}`);

    if (this.delayNode) { 
      this.delayNode.delayTime.value = (60 / this.bpm) * (rng() < 0.5 ? 0.50 : 0.25); 
    }
    if (this.feedbackNode) {
      this.feedbackNode.gain.value = 0.2 + rng() * 0.25; 
    }
    
    this.keyRootFreq = AudioEngine.ROOT_NOTES_HZ[Math.floor(rng() * AudioEngine.ROOT_NOTES_HZ.length)];
    const selectedScaleDef = AudioEngine.SCALES[Math.floor(rng() * AudioEngine.SCALES.length)];
    this.scale = selectedScaleDef.intervals;
    console.log(`New patterns: Key Root Freq: ${this.keyRootFreq.toFixed(2)}Hz, Scale: ${selectedScaleDef.name}`);

    this.currentScaleNotes = this.getNotesInScale(this.keyRootFreq, this.scale);

    this.progressionTemplate = AudioEngine.PROGRESSION_TEMPLATES[Math.floor(rng() * AudioEngine.PROGRESSION_TEMPLATES.length)];
    this.progressionIndex = 0; 
    this.barCount = 0; 

    this.currentScaleDegree = this.progressionTemplate[this.progressionIndex];
    const semitoneInKeyForFirstChordRoot = this.scale[this.currentScaleDegree % this.scale.length];
    const firstChordRootFreq = this.keyRootFreq * semitoneToRatio(semitoneInKeyForFirstChordRoot);
    // Pass rng to getDiatonicChordVoicing
    const firstChordVoicingIntervals = this.getDiatonicChordVoicing(this.currentScaleDegree, this.scale, rng); 
    
    this.currentChord = {
      rootFreq: firstChordRootFreq,
      intervals: firstChordVoicingIntervals,
      absoluteSemitones: firstChordVoicingIntervals.map(i => semitoneInKeyForFirstChordRoot + i)
    };
    console.log(`Primed first chord (Degree ${this.currentScaleDegree}): Root ${this.currentChord.rootFreq.toFixed(2)}Hz, Intervals [${this.currentChord.intervals.join(',')}]`);
  }

  private generateNextBar(rng: () => number): void { 
    // The first chord (bar 0) is primed by generateNewPatterns.
    // This function generates for the current this.barCount.
    // Advance progression only if it's not the very first setup.
    if (this.barCount > 0 || (this.barCount === 0 && this.progressionIndex > 0) ) { // Allow first chord if progIndex already moved (e.g. manual advance)
         // This logic was refined: generateNewPatterns sets barCount = 0 and primes chord for bar 0.
         // Scheduler calls generateNextBar at current16thStepInBar = 0.
         // So, if barCount is 0 here, it's the first "scheduled" generation for bar 0.
         // We advance for the *next* bar if barCount > 0.
         // Correct logic:
         // if (this.barCount > 0 || this.progressionIndex > 0 ) { // if not the absolute first chord of a new pattern set
        // Actually, simpler: generateNewPatterns sets up bar 0.
        // Scheduler will call this for current16thStepInBar = 0 when barCount is 0.
        // We want *that* call to use the already primed chord.
        // Then barCount becomes 1. The *next* call (for bar 1) should advance.
    }
    // Corrected logic for advancing progression:
    if (this.barCount > 0) { 
        this.progressionIndex = (this.progressionIndex + 1) % this.progressionTemplate.length;
    }
    this.currentScaleDegree = this.progressionTemplate[this.progressionIndex];

    const semitoneInKeyForChordRoot = this.scale[this.currentScaleDegree % this.scale.length];
    const chordRootFreq = this.keyRootFreq * semitoneToRatio(semitoneInKeyForChordRoot);
    // Pass rng to getDiatonicChordVoicing
    const chordVoicingIntervals = this.getDiatonicChordVoicing(this.currentScaleDegree, this.scale, rng); 
    
    this.currentChord = {
      rootFreq: chordRootFreq,
      intervals: chordVoicingIntervals,
      absoluteSemitones: chordVoicingIntervals.map(i => semitoneInKeyForChordRoot + i)
    };
    
    // --- Pad Note Generation ---
    const baseOctavePad = -1; 
    let padTargetFrequencies = this.currentChord!.intervals.map(interval =>
      this.currentChord!.rootFreq * semitoneToRatio(interval + (baseOctavePad * 12))
    );
    const ledPadFrequencies = this.voiceLeadPads(padTargetFrequencies, this.prevPadFrequencies);
   
    this.currentPadNotes = ledPadFrequencies.map(freq => ({
      frequency: freq,
      duration: 3.8, 
      velocity: 0.1 + this.seededRandom(this.currentSeed + this.barCount + freq)() * 0.05,
      type: 'triangle', 
      attack: 1.5,    
      decay: 1.0,     
      sustain: 0.7,   
      release: 2.0,   
      instrument: 'pad',
    }));
    this.prevPadFrequencies = [...ledPadFrequencies]; 
    // --- End Pad Note Generation ---

    // --- Bass Note Generation ---
    this.currentBassNote = null; 
    if (this.currentChord) {
      let bassFrequency = this.currentChord.rootFreq;
      const playFifthChance = 0.25; 

      if (rng() < playFifthChance && this.currentChord.intervals.length >= 1) { // Check if intervals exist
        const fifthInterval = this.currentChord.intervals.find(val => val === 7 || val === 6 || val === 8); 
        if (fifthInterval !== undefined) { 
             bassFrequency = this.currentChord.rootFreq * semitoneToRatio(fifthInterval);
        }
      }

      while (bassFrequency > 150) { 
        bassFrequency /= 2;
      }
      while (bassFrequency < 40) { 
         bassFrequency *=2;
         if (bassFrequency > 150 && bassFrequency/2 >=40) { 
             bassFrequency /=2;
             break;
         }
      }
      if (bassFrequency < 25) bassFrequency = 25;

      this.currentBassNote = {
        frequency: bassFrequency,
        duration: rng() < 0.4 ? 1.8 : 3.8, 
        velocity: 0.25 + rng() * 0.1, 
        type: 'sine', 
        attack: 0.02,   
        decay: 0.15,    
        sustain: 0.8,   
        release: 0.3,   
        instrument: 'bass',
        targetBeatInBar: 0, 
      };
    }
    // --- End Bass Note Generation ---

    // --- Drum Pattern Generation ---
    const kickPattern = new Array(16).fill(0);
    const snarePattern = new Array(16).fill(0);
    const hihatPattern = new Array(16).fill(0);

    kickPattern[0] = 0.9 + rng() * 0.1; 
    if (rng() < 0.6) kickPattern[8] = 0.8 + rng() * 0.1; 
    if (rng() < 0.2) kickPattern[6] = 0.6 + rng() * 0.1; 
    if (rng() < 0.3) kickPattern[12] = 0.7 + rng() * 0.1;

    snarePattern[4] = 0.85 + rng() * 0.15; 
    snarePattern[12] = 0.9 + rng() * 0.1;  
    if (rng() < 0.15) snarePattern[7] = 0.5 + rng() * 0.1; 
    if (rng() < 0.1) snarePattern[15] = 0.4 + rng() * 0.1; 

    for (let i = 0; i < 16; i += 2) { 
      if (rng() < 0.85) hihatPattern[i] = 0.4 + rng() * 0.2;
    }
    if (rng() < 0.4) hihatPattern[3] = 0.3 + rng() * 0.15;
    if (rng() < 0.3) hihatPattern[7] = 0.3 + rng() * 0.15;
    if (rng() < 0.5) hihatPattern[10] = 0.35 + rng() * 0.15;
    if (rng() < 0.2) hihatPattern[13] = 0.25 + rng() * 0.1;
    
    if (rng() < 0.3 && hihatPattern[2] > 0) hihatPattern[2] += 0.15;
    if (rng() < 0.3 && hihatPattern[6] > 0) hihatPattern[6] += 0.15;
    if (rng() < 0.3 && hihatPattern[10] > 0) hihatPattern[10] += 0.15;
    if (rng() < 0.3 && hihatPattern[14] > 0) hihatPattern[14] += 0.15;

    this.currentDrumPattern = {
      kick: kickPattern,
      snare: snarePattern,
      hihat: hihatPattern,
    };
    // --- End Drum Pattern Generation ---

    // --- Atmosphere Note Generation ---
    if (this.barCount >= this.atmosphereNextChangeBar || !this.currentAtmosphereNote) {
      const droneMinMidi = 24; 
      const droneMaxMidi = 48; 
      let droneTargetMidi = Math.round(69 + 12 * Math.log2(this.keyRootFreq / 440)); 

      if (rng() < 0.3 && this.scale.includes(7)) { 
         droneTargetMidi = Math.round(69 + 12 * Math.log2((this.keyRootFreq * semitoneToRatio(7)) / 440));
      }

      while (droneTargetMidi > droneMaxMidi && droneTargetMidi - 12 >= droneMinMidi) droneTargetMidi -= 12;
      while (droneTargetMidi < droneMinMidi && droneTargetMidi + 12 <= droneMaxMidi) droneTargetMidi += 12;

      if (this.currentScaleNotes.includes(droneTargetMidi)) {
        const atmoFreq = 440 * Math.pow(2, (droneTargetMidi - 69) / 12);
        const atmosphereDurationBars = 4 + Math.floor(rng() * 5); 
        this.atmosphereNextChangeBar = this.barCount + atmosphereDurationBars;

        this.currentAtmosphereNote = {
          frequency: atmoFreq,
          duration: atmosphereDurationBars * 4, 
          velocity: 0.03 + rng() * 0.02, 
          type: 'triangle',
          attack: 8.0 + rng() * 4.0,  
          decay: 2.0,                 
          sustain: 0.8,               
          release: 10.0 + rng() * 5.0, 
          instrument: 'atmosphere',
          targetBeatInBar: 0, 
        };
        (this.currentAtmosphereNote as any).isNew = true; 

      } else {
        this.currentAtmosphereNote = null; 
      }
    } else if (this.currentAtmosphereNote) {
      delete (this.currentAtmosphereNote as any).isNew;
    }
    // --- End Atmosphere Note Generation ---
  }

  private scheduleDrum(type: 'kick' | 'snare' | 'hihat', time: number, velocity: number): void {
    if (!this.audioContext || velocity === 0) return;

    if (type === 'kick') {
      const osc = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, time); 
      osc.frequency.exponentialRampToValueAtTime(40, time + 0.2); 

      gainNode.gain.setValueAtTime(0, time);
      gainNode.gain.linearRampToValueAtTime(velocity * 1.2, time + 0.01); 
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.3); 

      osc.connect(gainNode);
      gainNode.connect(this.mainGainNode);
      osc.start(time);
      osc.stop(time + 0.35); 
    } 
    else if (type === 'snare') {
      const noise = this.audioContext.createBufferSource();
      const bufferSize = this.audioContext.sampleRate * 0.2; 
      const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      const rngNoise = Math.random; 
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (rngNoise() * 2 - 1) * 0.6; 
      }
      noise.buffer = buffer;

      const noiseFilter = this.audioContext.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 1500 + rngNoise() * 500; 
      noiseFilter.Q.value = 1.5;

      const gainNode = this.audioContext.createGain();
      gainNode.gain.setValueAtTime(0, time);
      gainNode.gain.linearRampToValueAtTime(velocity, time + 0.005); 
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.15); 

      noise.connect(noiseFilter);
      noiseFilter.connect(gainNode);
      gainNode.connect(this.mainGainNode);
      noise.start(time);
      noise.stop(time + 0.2);
    } 
    else if (type === 'hihat') {
      const noise = this.audioContext.createBufferSource();
      const bufferSize = this.audioContext.sampleRate * 0.1; 
      const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      const rngNoise = Math.random;
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (rngNoise() * 2 - 1) * 0.4;
      }
      noise.buffer = buffer;

      const noiseFilter = this.audioContext.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.value = 7000; 
      noiseFilter.Q.value = 0.5;
      
      const gainNode = this.audioContext.createGain();
      gainNode.gain.setValueAtTime(0, time);
      gainNode.gain.linearRampToValueAtTime(velocity * 0.8, time + 0.002); 
      gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 0.05); 

      noise.connect(noiseFilter);
      noiseFilter.connect(gainNode);
      gainNode.connect(this.mainGainNode);
      noise.start(time);
      noise.stop(time + 0.1);
    }
  }

  private scheduleNote(note: Note, time: number): void {
    if (!note.instrument || !this.audioContext) return;

    const beatDuration = 60 / this.bpm;
    const actualAttack = note.attack ?? 0.01;
    const actualDecay = note.decay ?? 0.1; 
    const actualSustainLevel = note.sustain ?? 0.7;
    const actualRelease = note.release ?? 0.5;
    const noteVelocity = note.velocity || 0.3;

    const sustainPhaseEndTime = time + (note.duration * beatDuration);
    // const totalNoteDuration = (note.duration * beatDuration) + actualRelease; // Not used directly in this envelope

    const noteGain = this.audioContext.createGain();
    noteGain.gain.setValueAtTime(0, time);
    noteGain.gain.linearRampToValueAtTime(noteVelocity, time + actualAttack);
    noteGain.gain.setValueAtTime(noteVelocity * actualSustainLevel, sustainPhaseEndTime);
    noteGain.gain.linearRampToValueAtTime(0, sustainPhaseEndTime + actualRelease);
    noteGain.connect(this.mainGainNode);

    if (note.instrument === 'pad') {
      const osc1 = this.audioContext.createOscillator();
      osc1.type = note.type as OscillatorType || 'triangle';
      osc1.frequency.setValueAtTime(note.frequency, time);
      osc1.detune.setValueAtTime(-5, time); 

      const osc2 = this.audioContext.createOscillator();
      osc2.type = note.type as OscillatorType || 'triangle';
      osc2.frequency.setValueAtTime(note.frequency, time);
      osc2.detune.setValueAtTime(5, time);

      const padFilter = this.audioContext.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.setValueAtTime(800 + noteVelocity * 400, time); 
      padFilter.Q.value = 0.7;

      osc1.connect(padFilter);
      osc2.connect(padFilter);
      padFilter.connect(noteGain);

      osc1.start(time);
      osc2.start(time);
      osc1.stop(sustainPhaseEndTime + actualRelease + 0.1); 
      osc2.stop(sustainPhaseEndTime + actualRelease + 0.1);
    } else if (note.instrument === 'bass') {
      const osc = this.audioContext.createOscillator();
      osc.type = (note.type as OscillatorType) || 'sine'; 
      osc.frequency.setValueAtTime(note.frequency, time);

      const bassFilter = this.audioContext.createBiquadFilter();
      bassFilter.type = 'lowpass';
      bassFilter.frequency.setValueAtTime(600, time); 
      bassFilter.Q.value = 1;

      osc.connect(bassFilter);
      bassFilter.connect(noteGain);

      osc.start(time);
      osc.stop(sustainPhaseEndTime + actualRelease + 0.1); 
    } else if (note.instrument === 'atmosphere') {
      const osc = this.audioContext.createOscillator();
      osc.type = (note.type as OscillatorType) || 'triangle'; 
      osc.frequency.setValueAtTime(note.frequency, time);

      const atmoFilter = this.audioContext.createBiquadFilter();
      atmoFilter.type = 'lowpass';
      atmoFilter.frequency.setValueAtTime(note.frequency * 2, time); 
      if (note.duration && beatDuration) { 
          atmoFilter.frequency.linearRampToValueAtTime(note.frequency * 0.8, time + (note.duration * beatDuration * 0.75));
      }
      atmoFilter.Q.value = 0.5;

      osc.connect(atmoFilter);
      atmoFilter.connect(noteGain);

      osc.start(time);
      osc.stop(sustainPhaseEndTime + actualRelease + 0.5); 
    }
    // console.log(`Scheduled: ${note.instrument} at ${time.toFixed(2)}s, Freq: ${note.frequency.toFixed(2)}Hz`);
  }

  private scheduler(): void {
    while (this.isPlaying && this.nextNoteTime < this.audioContext.currentTime + this.lookahead) {
      this.scheduleNextNotes(this.current16thStepInBar);
      this.advanceNote();
    }
  }

  private scheduleNextNotes(current16th: number): void {
    const time = this.nextNoteTime; 

    if (current16th === 0) {
      const barRng = this.seededRandom(this.currentSeed + this.barCount);
      this.generateNextBar(barRng);
      // console.log(`Bar ${this.barCount}: Chord Root ${this.currentChord?.rootFreq.toFixed(2)}Hz, Intervals [${this.currentChord?.intervals.join(',')}] (Degree ${this.currentScaleDegree})`);
      
      this.currentPadNotes.forEach(note => {
        this.scheduleNote(note, time); 
      });

      if (this.currentBassNote) {
        this.scheduleNote(this.currentBassNote, time);
      }
      if (this.currentAtmosphereNote && (this.currentAtmosphereNote as any).isNew) {
        this.scheduleNote(this.currentAtmosphereNote, time);
        delete (this.currentAtmosphereNote as any).isNew; 
      }
    }
    // Schedule drums for the current 16th step
    if (this.currentDrumPattern) { 
         const kickVel = this.currentDrumPattern.kick[current16th];
         if (kickVel > 0) this.scheduleDrum('kick', time, kickVel);
 
         const snareVel = this.currentDrumPattern.snare[current16th];
         if (snareVel > 0) this.scheduleDrum('snare', time, snareVel);
 
         const hihatVel = this.currentDrumPattern.hihat[current16th];
         if (hihatVel > 0) this.scheduleDrum('hihat', time, hihatVel);
    }
  }

  private advanceNote(): void {
    const secondsPer16thNote = (60.0 / this.bpm) / 4.0;
    this.nextNoteTime += secondsPer16thNote;
    
    this.current16thStepInBar = (this.current16thStepInBar + 1) % 16;
    if (this.current16thStepInBar === 0) {
      this.barCount++;
      // console.log(`Advanced to bar: ${this.barCount}`); 
    }
  }
  
  public async start(): Promise<void> {
    if (this.isPlaying) {
       console.log("AudioEngine already playing.");
       return;
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
      console.log("AudioContext resumed.");
    }

    this.isPlaying = true;
    this.nextNoteTime = this.audioContext.currentTime + 0.05; 
    this.current16thStepInBar = 0;
    this.barCount = 0; 
    
    this.generateNewPatterns(); // Primes BPM, first chord, etc.

    if (this.intervalId !== null) window.clearInterval(this.intervalId);
    this.intervalId = window.setInterval(() => this.scheduler(), this.scheduleInterval * 1000);
    
    console.log("AudioEngine started. BPM:", this.bpm);
  }

  public stop(): void {
    if (!this.isPlaying) {
       // console.log("AudioEngine already stopped.");
       return;
    }
    this.isPlaying = false;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
      // console.log("Scheduler interval cleared.");
    }

    this.mainGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
    // Fade out quickly to prevent clicks
    this.mainGainNode.gain.setValueAtTime(this.mainGainNode.gain.value, this.audioContext.currentTime); // Hold current value
    this.mainGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.05); 
    
    console.log("AudioEngine stopped.");
  }
  
  public cleanup(): void {
      this.stop();
      this.audioContext.close().then(() => console.log("AudioContext closed"));
  }
}

const audioEngine = new AudioEngine();
export default audioEngine;