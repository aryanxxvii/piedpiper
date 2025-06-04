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
  type?: string; // Added
  decay?: number; // Added
  sustain?: number; // Added
};

interface DrumPattern {
  kick: number[];
  snare: number[];
  hihat: number[];
}

class AudioEngine {
  private audioContext: AudioContext;
  private mainGainNode: GainNode;
  private readonly VOLUME_STORAGE_KEY = 'audioEngine_volume';
  private currentVolume: number = 0.3; // Default, will be overridden by saved value

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

  private static PROGRESSION_TEMPLATES = [
    [0, 3, 4, 0],    // I-IV-V-I (Classic positive)
    [1, 4, 0, 0],    // ii-V-I-I (Strong resolution to tonic)
    [0, 5, 1, 4],    // I-vi-ii-V (Common, generally upbeat in major context)
    [0, 1, 3, 4],    // I-ii-IV-V (Smooth, positive movement)
    [3, 4, 0, 0],    // IV-V-I-I (Plagal-influenced, bright)
    [0, 4, 5, 4],    // I-V-vi-V (Uses vi but surrounded by I and V, common pop/jazz)
    [0, 3, 0, 4]     // I-IV-I-V (Stable, emphasizing tonic and subdominant)
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
  private currentDrumPattern: DrumPattern | null = null; // Added

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
    
    // Load saved volume or use default
    const savedVolume = localStorage.getItem(this.VOLUME_STORAGE_KEY);
    this.currentVolume = savedVolume ? parseFloat(savedVolume) : 0.35;
    this.mainGainNode.gain.value = this.currentVolume;
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
    this.currentVolume = Math.max(0, Math.min(1, volume));
    this.mainGainNode.gain.setValueAtTime(this.currentVolume, this.audioContext.currentTime);
    localStorage.setItem(this.VOLUME_STORAGE_KEY, this.currentVolume.toString());
    console.log(`Volume set to: ${this.currentVolume}`);
  }
  
  public getVolume(): number {
    return this.currentVolume;
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
    
    const playSeventh = rng() < 0.9; // Increased chance for 7ths
    const playNinth = rng() < 0.5;   // Chance for 9ths on top of 7ths

    switch (quality) {
      case 'maj7':
        if (playSeventh) {
          if (playNinth && AudioEngine.CHORD_VOICINGS.maj9) return AudioEngine.CHORD_VOICINGS.maj9;
          return AudioEngine.CHORD_VOICINGS.maj7;
        }
        return AudioEngine.CHORD_VOICINGS.triadMaj;
      case 'min7':
        // Handle m7b5 case if relevant based on intervals (already somewhat handled by quality detection)
        // For now, directly use min7 or extend to min9
        if (playSeventh) {
          // A more robust m7b5 check could be:
          // const isHalfDim = (thirdInterval === 3 && fifthInterval === 6 && seventhInterval === 10);
          // if (isHalfDim && AudioEngine.CHORD_VOICINGS.m7b5) {
          //   return AudioEngine.CHORD_VOICINGS.m7b5;
          // }
          if (playNinth && AudioEngine.CHORD_VOICINGS.min9) return AudioEngine.CHORD_VOICINGS.min9;
          return AudioEngine.CHORD_VOICINGS.min7;
        }
        return AudioEngine.CHORD_VOICINGS.triadMin;
      case 'dom7':
        // Dominant chords almost always include the 7th in jazz/lofi
        if (playNinth && AudioEngine.CHORD_VOICINGS.dom9) return AudioEngine.CHORD_VOICINGS.dom9;
        // Add chance for dom7sus4 if contextually appropriate (e.g. V7sus before V7)
        // For now, defaulting to dom7 or dom9.
        return AudioEngine.CHORD_VOICINGS.dom7; // No playSeventh check, dom7 implies 7th
      case 'triadMaj':
        // This case implies playSeventh was false or quality was determined as major triad initially
        return AudioEngine.CHORD_VOICINGS.triadMaj;
      case 'triadMin': // This quality is set if the 3rd is minor.
        if (thirdInterval === 3 && fifthInterval === 6) { // Potential diminished, half-diminished, or fully diminished 7th
            if (playSeventh) {
                if (seventhInterval === 10 && AudioEngine.CHORD_VOICINGS.m7b5) { // Half-diminished 7th
                    return AudioEngine.CHORD_VOICINGS.m7b5;
                } else if (seventhInterval === 9 && AudioEngine.CHORD_VOICINGS.dim7) { // Fully diminished 7th
                    return AudioEngine.CHORD_VOICINGS.dim7;
                }
            }
            // Fallback to diminished triad if no 7th or specific 7th voicing not found/matched
            return AudioEngine.CHORD_VOICINGS.dimTriad || [0,3,6];
        }
        // Standard minor triad (if not diminished and playSeventh was false or quality was 'triadMin' initially)
        return AudioEngine.CHORD_VOICINGS.triadMin;
      default: 
        // Fallback for 'other' quality or unhandled scenarios
        if (thirdInterval === 4) { // Major-like
            if (playSeventh && seventhInterval === 11 && AudioEngine.CHORD_VOICINGS.maj7){
                if(playNinth && AudioEngine.CHORD_VOICINGS.maj9) return AudioEngine.CHORD_VOICINGS.maj9;
                return AudioEngine.CHORD_VOICINGS.maj7;
            }
            return AudioEngine.CHORD_VOICINGS.triadMaj;
        } else if (thirdInterval === 3) { // Minor-like
            if (playSeventh && seventhInterval === 10 && AudioEngine.CHORD_VOICINGS.min7){
                 if(playNinth && AudioEngine.CHORD_VOICINGS.min9) return AudioEngine.CHORD_VOICINGS.min9;
                return AudioEngine.CHORD_VOICINGS.min7;
            }
             if (thirdInterval === 3 && fifthInterval === 6) return AudioEngine.CHORD_VOICINGS.dimTriad || [0,3,6];
            return AudioEngine.CHORD_VOICINGS.triadMin;
        }
        // Ultimate fallback
        return AudioEngine.CHORD_VOICINGS.triadMaj; 
    }
  }

  public generateNewPatterns(): void {
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
      velocity: 0.08 + this.seededRandom(this.currentSeed + this.barCount + freq)() * 0.04, // Adjusted Velocity
      type: 'sine', // Changed type
      attack: 2.0 + rng() * 0.5,    // Adjusted Attack
      decay: 1.5,                   // Adjusted Decay
      sustain: 0.6,                 // Adjusted Sustain
      release: 2.5 + rng() * 0.5,   // Adjusted Release
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

      let bassTargetBeat = 0; // Default on the downbeat
      const bassRhythmRng = rng();
      if (bassRhythmRng < 0.2 && this.currentDrumPattern && this.currentDrumPattern.kick[3] > 0) { // Follow kick on 'a' of 1
          bassTargetBeat = 3;
      } else if (bassRhythmRng < 0.35 && this.currentDrumPattern && this.currentDrumPattern.kick[2] > 0) { // Follow kick on 'and' of 1
          bassTargetBeat = 2;
      } else if (bassRhythmRng < 0.15) { // rare chance for offbeat start
          bassTargetBeat = 1;
      }

      this.currentBassNote = {
        frequency: bassFrequency,
        duration: rng() < 0.4 ? (rng() < 0.5 ? 1.8 : 1.4) : (rng() < 0.5 ? 3.8 : 3.4), // more duration variation
        velocity: 0.22 + rng() * 0.08, // slightly lower velocity overall
        type: 'sine', 
        attack: 0.03 + rng() * 0.01,   // Adjusted Attack
        decay: 0.2 + rng() * 0.05,    // Adjusted Decay
        sustain: 0.6 + rng() * 0.1,   // Adjusted Sustain
        release: 0.4 + rng() * 0.1,   // Adjusted Release
        instrument: 'bass',
        target16thStep: bassTargetBeat, // Use this to schedule precisely
      };
    }
    // --- End Bass Note Generation ---

    // --- Electric Piano Melody Generation ---
    this.currentElectricPianoNotes = [];
    if (this.currentChord && rng() < 0.75) { // Chance to play EP melody this bar
      const numNotesToPlay = Math.floor(rng() * 3) + 1; // 1-3 notes per bar
      const availableChordTonesMidi = this.currentChord.absoluteSemitones
          .map(semi => 60 + semi); // Shift to a suitable MIDI octave range (e.g., C4=60)

      // Filter notes to be within a playable range (e.g., MIDI 55-80 for EP)
      let potentialEpNotesMidi = this.currentScaleNotes.filter(note => note >= 55 && note <= 80);
      if (potentialEpNotesMidi.length === 0) potentialEpNotesMidi = availableChordTonesMidi.filter(note => note >=55 && note <= 80);
      if (potentialEpNotesMidi.length === 0) potentialEpNotesMidi = [60, 64, 67, 71]; // Fallback if no suitable notes

      for (let i = 0; i < numNotesToPlay; i++) {
        if (potentialEpNotesMidi.length > 0) {
          const midiNote = potentialEpNotesMidi[Math.floor(rng() * potentialEpNotesMidi.length)];
          const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

          // Spread notes out, avoid very end
          const actualTarget16th = (i === 0) ? (rng() < 0.4 ? 0 : (2 + Math.floor(rng()*6))) : ( (this.currentElectricPianoNotes[i-1]?.target16thStep || 0) + 4 + Math.floor(rng()*4) ) % 16;

          if (this.currentElectricPianoNotes.find(n => n.target16thStep === actualTarget16th)) continue; // Avoid collision

          this.currentElectricPianoNotes.push({
            frequency: freq,
            duration: (rng() < 0.3 ? 0.4 : 0.8) + rng() * 0.5, // Beat duration for EP notes
            velocity: 0.12 + rng() * 0.13, // New Velocity: 0.12 - 0.25
            type: 'sine', // Base type, actual sound from multiple oscs in scheduleNote
            attack: 0.015 + rng()*0.01,   // New Attack
            decay: 0.2 + rng()*0.1,    // New Decay
            sustain: 0.35 + rng()*0.15,   // New Sustain
            release: 0.3 + rng()*0.1,   // New Release
            instrument: 'electricPiano',
            target16thStep: actualTarget16th,
          });
        }
      }
    }
    // --- End Electric Piano Melody Generation ---

    // --- Drum Pattern Generation (Lofi Style) ---
    const kickPattern = new Array(16).fill(0);
    const snarePattern = new Array(16).fill(0);
    const hihatPattern = new Array(16).fill(0);
    const barRng = rng; // Use the bar's seeded random number generator

    // Kick drum (Lofi - sparser, groovier)
    kickPattern[0] = 0.9 + barRng() * 0.1; // Beat 1 almost always

    // Chance for a kick on beat 3, but not always
    if (barRng() < 0.6) kickPattern[8] = 0.75 + barRng() * 0.1;

    // Reduced & sparser syncopation
    const syncKickRoll = barRng();
    if (syncKickRoll < 0.20) {
        kickPattern[6] = 0.6 + barRng() * 0.1;  // 'and' of 2
    } else if (syncKickRoll < 0.30) {
        kickPattern[11] = 0.5 + barRng() * 0.1; // 'e' of 3 or 'and' of 3 (less common)
    } else if (syncKickRoll < 0.38) {
        kickPattern[3] = 0.55 + barRng() * 0.1; // 'a' of 1 (occasional)
    }
    // Removed other more complex kick placements from previous versions.

    // Snare drum (Lofi - clear 2 & 4, very sparse ghosts)
    snarePattern[4] = 0.8 + barRng() * 0.2;  // Beat 2
    snarePattern[12] = 0.85 + barRng() * 0.15; // Beat 4

    // Snare ghost notes (reduced probability and impact)
    const ghostSnareRoll = barRng();
    if (ghostSnareRoll < 0.12) {
        snarePattern[7] = 0.1 + barRng() * 0.05; // Ghost note before beat 3
    } else if (ghostSnareRoll < 0.20) {
        snarePattern[14] = 0.15 + barRng() * 0.05;  // Softer fill before next bar
    } else if (ghostSnareRoll < 0.25) {
        snarePattern[10] = 0.08 + barRng() * 0.05; // Very soft ghost
    }
    // Removed some previous ghost note possibilities to make them rarer.

    // Hi-hats (aiming for a slightly swung or busy feel with velocity variations)
    for (let i = 0; i < 16; i++) {
      const isDownbeat8th = i % 2 === 0;
      // const isOffbeat16th = i % 2 !== 0; // Variable not used

      if (isDownbeat8th) { // Potentially stronger, main hats
        if (barRng() < 0.8) hihatPattern[i] = (0.3 + barRng() * 0.25);
      } else { // Offbeat 16ths, often softer for swing or fill
        if (barRng() < 0.55) hihatPattern[i] = (0.15 + barRng() * 0.15); // Reduced probability & max velocity
      }
      // Add slight emphasis to main 8th notes if an offbeat 16th is also present before it
      if (isDownbeat8th && i > 0 && hihatPattern[i-1] > 0 && hihatPattern[i] > 0) {
          hihatPattern[i] += 0.03; // Reduced accent strength
      }
    }
    // Ensure some main beats have hi-hats if pattern is sparse
    if (hihatPattern[0] === 0 && barRng() < 0.9) hihatPattern[0] = 0.3 + barRng() * 0.1;
    if (hihatPattern[4] === 0 && barRng() < 0.7) hihatPattern[4] = 0.25 + barRng() * 0.1;
    if (hihatPattern[8] === 0 && barRng() < 0.7) hihatPattern[8] = 0.25 + barRng() * 0.1;
    if (hihatPattern[12] === 0 && barRng() < 0.7) hihatPattern[12] = 0.25 + barRng() * 0.1;

    // Randomly make some hi-hats more open (longer decay) - this is a placeholder for sound change
    // Actual sound change for open hi-hat would need scheduleDrum modification.
    // For now, just increase velocity slightly for emphasis.
    if (barRng() < 0.10 && hihatPattern[14] > 0) hihatPattern[14] += 0.15; // Reduced prob and strength
    else if (barRng() < 0.08 && hihatPattern[6] > 0) hihatPattern[6] += 0.12; // Further reduced for step 6
    
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
    const rngNoise = Math.random; // For sound variations, as distinct from seeded rng for patterns

    if (type === 'kick') {
      const osc = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      osc.type = 'sine';
      // osc.frequency.setValueAtTime(120, time);
      // osc.frequency.exponentialRampToValueAtTime(40, time + 0.2);
      osc.frequency.setValueAtTime(rngNoise() < 0.5 ? 90 : 100, time);
      osc.frequency.exponentialRampToValueAtTime(rngNoise() < 0.5 ? 40 : 50, time + (rngNoise() < 0.4 ? 0.15 : 0.2));

      gainNode.gain.setValueAtTime(0, time);
      // gainNode.gain.linearRampToValueAtTime(velocity * 1.2, time + 0.01);
      // gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      gainNode.gain.linearRampToValueAtTime(velocity * 1.1, time + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.25);


      osc.connect(gainNode);
      gainNode.connect(this.mainGainNode);
      osc.start(time);
      // osc.stop(time + 0.35);
      osc.stop(time + 0.3); // Slightly shorter stop for potentially tighter sound
    } 
    else if (type === 'snare') {
      const noise = this.audioContext.createBufferSource();
      const bufferSize = this.audioContext.sampleRate * 0.2; 
      const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      // const rngNoise = Math.random; // Already defined above
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (rngNoise() * 2 - 1) * 0.6; 
      }
      noise.buffer = buffer;

      const noiseFilter = this.audioContext.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      // noiseFilter.frequency.value = 1500 + rngNoise() * 500;
      // noiseFilter.Q.value = 1.5;
      noiseFilter.frequency.value = 1200 + rngNoise() * 400;
      noiseFilter.Q.value = 1.2 + rngNoise() * 0.5;


      const gainNode = this.audioContext.createGain();
      gainNode.gain.setValueAtTime(0, time);
      gainNode.gain.linearRampToValueAtTime(velocity, time + 0.005); 
      // gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + (0.1 + rngNoise() * 0.03));


      noise.connect(noiseFilter);
      noiseFilter.connect(gainNode);
      gainNode.connect(this.mainGainNode);
      noise.start(time);
      // noise.stop(time + 0.2);
      noise.stop(time + 0.15); // Slightly shorter stop
    } 
    else if (type === 'hihat') {
      const noise = this.audioContext.createBufferSource();
      const bufferSize = this.audioContext.sampleRate * 0.1; 
      const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      // const rngNoise = Math.random; // Already defined above
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (rngNoise() * 2 - 1) * 0.4;
      }
      noise.buffer = buffer;

      const noiseFilter = this.audioContext.createBiquadFilter();
      // noiseFilter.type = 'highpass';
      // noiseFilter.frequency.value = 7000;
      // noiseFilter.Q.value = 0.5;
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 7000 + rngNoise() * 2000;
      noiseFilter.Q.value = 0.8 + rngNoise() * 0.4;
      
      const gainNode = this.audioContext.createGain();
      gainNode.gain.setValueAtTime(0, time);
      // gainNode.gain.linearRampToValueAtTime(velocity * 0.8, time + 0.002);
      // gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      gainNode.gain.linearRampToValueAtTime(velocity * 0.7, time + 0.002);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, time + (0.025 + rngNoise() * 0.01));


      noise.connect(noiseFilter);
      noiseFilter.connect(gainNode);
      gainNode.connect(this.mainGainNode);
      noise.start(time);
      // noise.stop(time + 0.1);
      noise.stop(time + 0.05); // Significantly shorter
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
    const localRng = Math.random; // For sound variations within scheduleNote

    if (note.instrument === 'pad') {
      const osc1 = this.audioContext.createOscillator();
      osc1.type = 'sine'; // Changed type
      osc1.frequency.setValueAtTime(note.frequency, time);
      osc1.detune.setValueAtTime(-3, time); // Adjusted detune

      const osc2 = this.audioContext.createOscillator();
      osc2.type = 'sine'; // Changed type
      osc2.frequency.setValueAtTime(note.frequency, time);
      osc2.detune.setValueAtTime(3, time); // Adjusted detune

      const padFilter = this.audioContext.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.setValueAtTime(500 + noteVelocity * 250, time); // Adjusted filter
      padFilter.Q.value = 0.6; // Adjusted Q

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
      bassFilter.frequency.setValueAtTime(350 + noteVelocity * 150, time); // Adjusted filter
      bassFilter.Q.value = 0.9; // Adjusted Q

      osc.connect(bassFilter);
      bassFilter.connect(noteGain);

      osc.start(time);
      osc.stop(sustainPhaseEndTime + actualRelease + 0.1); 
    } else if (note.instrument === 'electricPiano') {
      const osc1 = this.audioContext.createOscillator();
      osc1.type = 'sine'; // Base tone
      osc1.frequency.setValueAtTime(note.frequency, time);
      // osc1.detune.setValueAtTime(-2, time); // Optional slight detune

      const osc2 = this.audioContext.createOscillator();
      osc2.type = 'triangle'; // Changed back to triangle
      osc2.frequency.setValueAtTime(note.frequency, time); // Unison
      osc2.detune.setValueAtTime((localRng() * 12 - 6), time); // Retain detune logic

      const epGain = this.audioContext.createGain();
      epGain.gain.value = 0.8;

      const osc2Gain = this.audioContext.createGain(); // New gain for osc2
      osc2Gain.gain.value = 0.35; // Mix triangle lower

      osc2.connect(osc2Gain);
      osc2Gain.connect(epGain);
      osc1.connect(epGain); // osc1 connects directly to epGain

      const epFilter = this.audioContext.createBiquadFilter();
      epFilter.type = 'lowpass';
      epFilter.frequency.setValueAtTime(450 + (note.velocity || 0.2) * 700, time); // Adjusted filter frequency
      epFilter.Q.value = 0.6; // Fixed Q

      epGain.connect(epFilter); // epGain (with mixed oscs) connects to filter
      epFilter.connect(noteGain); // noteGain is the main ADSR envelope gain

      osc1.start(time);
      osc2.start(time);
      osc1.stop(sustainPhaseEndTime + actualRelease + 0.1);
      osc2.stop(sustainPhaseEndTime + actualRelease + 0.1);
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

      // if (this.currentBassNote) {
      //   this.scheduleNote(this.currentBassNote, time);
      // }
      if (this.currentBassNote && this.currentBassNote.target16thStep === current16th) {
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
    // Schedule Electric Piano Notes
    this.currentElectricPianoNotes.forEach(note => {
      if (note.target16thStep === current16th) {
        this.scheduleNote(note, time);
      }
    });
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

    // Rebuild the audio graph with the correct volume
    this.mainGainNode.disconnect();
    this.mainGainNode = this.audioContext.createGain();
    this.mainGainNode.gain.value = this.currentVolume;
    
    // Rebuild the complete audio graph
    this.mainGainNode.connect(this.lowpassFilter);
    this.lowpassFilter.connect(this.dryGain);
    this.dryGain.connect(this.audioContext.destination);
    this.lowpassFilter.connect(this.delayNode);
    this.delayNode.connect(this.delayFilterNode);
    this.delayFilterNode.connect(this.feedbackNode);
    this.feedbackNode.connect(this.delayNode);
    this.delayFilterNode.connect(this.wetGain);
    this.wetGain.connect(this.audioContext.destination);
    
    if (this.reverbNode) {
      this.lowpassFilter.connect(this.reverbNode);
      this.reverbNode.connect(this.wetGain);
    }

    this.isPlaying = true;
    this.nextNoteTime = this.audioContext.currentTime + 0.05; 
    this.current16thStepInBar = 0;
    this.barCount = 0; 
    
    this.generateNewPatterns(); // Primes BPM, first chord, etc.

    if (this.intervalId !== null) window.clearInterval(this.intervalId);
    this.intervalId = window.setInterval(() => this.scheduler(), this.scheduleInterval * 1000);
    
    console.log("AudioEngine started. BPM:", this.bpm, "Volume:", this.currentVolume);
  }

  public stop(): void {
    if (!this.isPlaying) {
      return;
    }
    this.isPlaying = false;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // Immediately silence all audio by disconnecting the main gain node
    // but first store the current volume to restore later
    const currentVolume = this.mainGainNode.gain.value;
    this.mainGainNode.disconnect();
    
    // Reconnect the gain node with volume set to 0
    this.mainGainNode = this.audioContext.createGain();
    this.mainGainNode.gain.value = 0;
    
    // Rebuild the audio graph structure without connecting to destination
    this.mainGainNode.connect(this.lowpassFilter);
    this.lowpassFilter.connect(this.dryGain);
    this.lowpassFilter.connect(this.delayNode);
    
    // Store the current volume to be restored on play
    this.currentVolume = currentVolume;
    
    console.log("AudioEngine stopped.");
  }
  
  public cleanup(): void {
      this.stop();
      this.audioContext.close().then(() => console.log("AudioContext closed"));
  }
}

const audioEngine = new AudioEngine();
export default audioEngine;