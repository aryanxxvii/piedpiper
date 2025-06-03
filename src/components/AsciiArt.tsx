
import React from 'react';

interface AsciiArtProps {
  className?: string;
}

export const CoffeeAscii: React.FC<AsciiArtProps> = ({ className }) => {
  return (
    <div className={`ascii-art text-lavender ${className}`}>
      <span className="block">         )</span>
      <span className="block">        (</span>
      <span className="block">    _______.</span>
      <span className="block">   |       |_____</span>
      <span className="block">   |       |     )</span>
      <span className="block">   |_______|____/</span>
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
