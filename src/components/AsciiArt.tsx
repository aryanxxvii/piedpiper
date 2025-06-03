
import React, { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import audioEngine from '@/utils/audioEngine';

interface AsciiArtProps {
  className?: string;
}

export const CoffeeAscii: React.FC<AsciiArtProps> = ({ className }) => {
  const [steamLine1, setSteamLine1] = useState('( (');
  const [steamLine2, setSteamLine2] = useState(') )');
  const [showSeedInput, setShowSeedInput] = useState(false);
  const [seedInput, setSeedInput] = useState('');

  // Steam animation patterns
  const steamPatterns = [
    ['( (', ') )'],
    [') )', '( ('],
    ['( )', ') ('],
    [') (', '( )'],
    ['( )', '( )'],
    [') )', ') )'],
    ['( (', '( (']
  ];

  useEffect(() => {
    let currentPattern = 0;
    
    const animateSteam = () => {
      setSteamLine1(steamPatterns[currentPattern][0]);
      setSteamLine2(steamPatterns[currentPattern][1]);
      currentPattern = (currentPattern + 1) % steamPatterns.length;
    };

    // Animate steam every 400ms
    const interval = setInterval(animateSteam, 800);
    return () => clearInterval(interval);
  }, []);

  const handleSeedSubmit = () => {
    const newSeed = parseInt(seedInput);
    if (!isNaN(newSeed)) {
      audioEngine.setSeed(newSeed);
      audioEngine.generateNewPatterns();
    }
    setShowSeedInput(false);
    setSeedInput('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSeedSubmit();
    } else if (e.key === 'Escape') {
      setShowSeedInput(false);
      setSeedInput('');
    }
  };

  return (
    <div className={`ascii-art text-lavender font-mono text-xs ${className}`}>
      <div className="relative">
        <div className="whitespace-pre-line">
          <span className="block text-mauve whitespace-pre mb-2">{`    ${steamLine1}`}</span>
          <span className="block text-pink whitespace-pre">{`     ${steamLine2}`}</span>
          <div className="text-flamingo">
            <span className="block whitespace-pre">  ..........</span>
            <span className="block whitespace-pre">  |        |]</span>
            <span className="block whitespace-pre">  |        |</span>
            <span className="block whitespace-pre">  \        /</span>
            <span className="block whitespace-pre">   '------'</span>
          </div>
          <span className=" opacity-50 block whitespace-pre ml-[1.6em]">piedpiper</span>
        </div>
        
        {/* Seed display/input on hover */}
        <div 
          className="absolute inset-0 mt-8 ml-2 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
          onMouseEnter={() => setSeedInput(audioEngine.getSeed().toString())}
          onClick={() => setShowSeedInput(true)}
        >
          {showSeedInput ? (
            <Input
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              onKeyDown={handleKeyPress}
              onBlur={handleSeedSubmit}
              className="!text-xs px-1 text-xs text-center text-green bg-[rgba(0,0,0,0)] border-none"
              autoFocus
            />
          ) : (
            <span className="text-xs text-rosewater px-1 rounded">
              {audioEngine.getSeed()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const SteamAscii: React.FC<AsciiArtProps & { animationDelay?: string }> = 
  ({ className, animationDelay = '0s' }) => {
  return (
    <div 
      className={`ascii-art absolute ${className}`} 
      style={{ animationDelay }}
    >
      <span className="block text-subtext0">  ~</span>
      <span className="block text-subtext0"> ~</span>
      <span className="block text-subtext0">  ~</span>
    </div>
  );
};

export const CatAscii: React.FC<AsciiArtProps> = ({ className }) => {
  return (
    <div className={`ascii-art text-mauve text-xs ${className}`}>
      <span className="block">  /\_/\</span>
      <span className="block"> ( o.o )</span>
      <span className="block"> &gt; ^ &lt;</span>
    </div>
  );
};

export const VinylAscii: React.FC<AsciiArtProps & { spinning?: boolean }> = ({ className, spinning = false }) => {
  const spinClass = spinning ? "animate-spin" : "";
  return (
    <div className={`ascii-art text-blue ${className} ${spinClass}`} style={{ animationDuration: '8s' }}>
      <span className="block">     __</span>
      <span className="block">    /  \</span>
      <span className="block">   |    |</span>
      <span className="block">   |    |</span>
      <span className="block">    \__/</span>
    </div>
  );
};
