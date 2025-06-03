
import React from 'react';
import { CatAscii } from './AsciiArt';

const PersistentCat: React.FC = () => {
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-pulse-slow opacity-70">
      <CatAscii />
    </div>
  );
};

export default PersistentCat;
