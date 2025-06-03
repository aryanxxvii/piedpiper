
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
    const interval = setInterval(animateSteam, 400);
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
    <div className={`ascii-art text-lavender font-mono ${className}`}>
      <div className="relative">
        <div className="whitespace-pre-line">
          <span className="block text-subtext0">{`   ${steamLine1}`}</span>
          <span className="block text-subtext0">{`    ${steamLine2}`}</span>
          <span className="block">  ........</span>
          <span className="block">  |      |]</span>
          <span className="block">  \      /</span>
          <span className="block">   `----'</span>
        </div>
        
        {/* Seed display/input on hover */}
        <div 
          className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
          onMouseEnter={() => setSeedInput(audioEngine.getSeed().toString())}
          onClick={() => setShowSeedInput(true)}
        >
          {showSeedInput ? (
            <Input
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              onKeyDown={handleKeyPress}
              onBlur={handleSeedSubmit}
              className="w-16 h-6 text-xs text-center bg-surface0 border-surface2"
              autoFocus
            />
          ) : (
            <span className="text-xs text-subtext0 bg-surface0 px-1 rounded">
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
