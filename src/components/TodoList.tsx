import React, { useState, useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import audioEngine from '@/utils/audioEngine';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

const TodoList: React.FC = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const todoListRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  // Load todos from localStorage on component mount
  useEffect(() => {
    const savedTodos = localStorage.getItem('focus-todos');
    if (savedTodos) {
      try {
        const parsedTodos = JSON.parse(savedTodos);
        setTodos(parsedTodos);
      } catch (error) {
        console.error('Error loading todos from localStorage:', error);
      }
    }
  }, []);

  // Save todos to localStorage whenever todos change
  useEffect(() => {
    localStorage.setItem('focus-todos', JSON.stringify(todos));
  }, [todos]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keys when input is focused
      if (showAddInput && document.activeElement === inputRef.current) {
        if (e.key === 'Escape') {
          setShowAddInput(false);
          setNewTodo('');
        }
        return;
      }

      // Don't handle keys when editing
      if (editingId && document.activeElement === editInputRef.current) {
        if (e.key === 'Escape') {
          setEditingId(null);
          setEditText('');
        }
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlayback();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(0, prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(todos.length - 1, prev + 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (todos.length > 0) {
            toggleTodo(todos[selectedIndex].id);
          }
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          setShowAddInput(true);
          setTimeout(() => inputRef.current?.focus(), 0);
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          if (todos.length > 0) {
            deleteTodo(todos[selectedIndex].id);
          }
          break;
        case 'e':
        case 'E':
          e.preventDefault();
          if (todos.length > 0) {
            startEditing(todos[selectedIndex]);
          }
          break;
        case '+':
        case '=':
          e.preventDefault();
          adjustVolume(0.1);
          break;
        case '-':
        case '_':
          e.preventDefault();
          adjustVolume(-0.1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [todos, selectedIndex, showAddInput, editingId]);

  // Auto-scroll to keep selected item in view with extra padding
  useEffect(() => {
    if (selectedItemRef.current && todoListRef.current) {
      const container = todoListRef.current;
      const selectedItem = selectedItemRef.current;
      
      // Calculate if the element is outside the visible area
      const containerRect = container.getBoundingClientRect();
      const selectedRect = selectedItem.getBoundingClientRect();
      
      // Add padding to ensure borders are fully visible
      const paddingBottom = 15; // Extra padding to show bottom border
      const paddingTop = 15;    // Extra padding to show top border
      
      // Check if the selected item is outside the visible area
      if (selectedRect.bottom + paddingBottom > containerRect.bottom) {
        // If below visible area, scroll down with extra space
        container.scrollBy({
          top: selectedRect.bottom - containerRect.bottom + paddingBottom,
          behavior: 'smooth'
        });
      } else if (selectedRect.top - paddingTop < containerRect.top) {
        // If above visible area, scroll up with extra space
        container.scrollBy({
          top: selectedRect.top - containerRect.top - paddingTop,
          behavior: 'smooth'
        });
      }
    }
  }, [selectedIndex]);

  const togglePlayback = async () => {
    if (audioEngine.getIsPlaying()) {
      audioEngine.stop();
    } else {
      try {
        // Generate new music patterns each time
        audioEngine.generateNewPatterns();
        await audioEngine.start();
      } catch (error) {
        console.error("Failed to start audio:", error);
      }
    }
  };

  const adjustVolume = (delta: number) => {
    const currentVolume = audioEngine.getVolume();
    const newVolume = Math.max(0, Math.min(1, currentVolume + delta));
    audioEngine.setVolume(newVolume);
  };

  const addTodo = () => {
    if (newTodo.trim()) {
      setTodos([...todos, { 
        id: Date.now(), 
        text: newTodo.trim(), 
        completed: false 
      }]);
      setNewTodo('');
      setShowAddInput(false);
    }
  };

  const toggleTodo = (id: number) => {
    setTodos(todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter(todo => todo.id !== id));
    if (selectedIndex >= todos.length - 1) {
      setSelectedIndex(Math.max(0, todos.length - 2));
    }
  };

  const startEditing = (todo: { id: number; text: string }) => {
    setEditingId(todo.id);
    setEditText(todo.text);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const saveEdit = () => {
    if (editText.trim() && editingId) {
      setTodos(todos.map(todo => 
        todo.id === editingId ? { ...todo, text: editText.trim() } : todo
      ));
      setEditingId(null);
      setEditText('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      addTodo();
    }
  };

  const handleEditKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit();
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-mantle rounded-lg shadow-md">
      
      {/* Todo list - scrollable container */}
      <div ref={todoListRef} className="space-y-2 pb-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {todos.map((todo, index) => (
          <div 
            key={todo.id}
            ref={index === selectedIndex ? selectedItemRef : undefined}
            className={`flex items-center gap-3 mt-2 ml-3 p-2 rounded-md  ${
              index === selectedIndex ? 'ring-2 ring-mauve ring-opacity-50 hover:bg-base' : 'hover:bg-base'
            }`}
          >
            <button
              onClick={() => toggleTodo(todo.id)}
              className={`w-4 h-4 rounded-md border-2 flex items-center justify-center transition-colors ${
                todo.completed 
                  ? 'bg-green border-green' 
                  : 'border-surface2 hover:border-subtext0'
              }`}
            >
              {todo.completed && (
                <span className="text-base text-xs">✓</span>
              )}
            </button>
            {editingId === todo.id ? (
              <Input
                ref={editInputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyPress={handleEditKeyPress}
                onBlur={saveEdit}
                className="flex-1 bg-surface0 border-surface2 text-text placeholder:text-subtext0 text-sm"
              />
            ) : (
              <span 
                className={`flex-1 text-sm overflow-hidden text-ellipsis whitespace-nowrap ${
                  todo.completed 
                    ? 'text-subtext0 line-through' 
                    : 'text-text'
                }`}
                title={todo.text}
              >
                {todo.text}
              </span>
            )}
            <button
              onClick={() => deleteTodo(todo.id)}
              className="text-subtext0 hover:text-red transition-colors opacity-0 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Add new todo input */}
      {showAddInput && (
        <div className="mb-4 px-3 py-0 ">
          <Input
            ref={inputRef}
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Add a new task..."
            className="bg-base py-0 my-0 max-h-9 border-none text-text placeholder:text-subtext0 text-sm"
          />
        </div>
      )}

      {/* Add button */}
      <div className="flex justify-center">
        <Button 
          onClick={() => {
            if (showAddInput) {
              addTodo();
            } else {
              setShowAddInput(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
          size="sm"
          className="bg-mantle text-subtext0 hover:bg-mauve hover:bg-opacity-75 hover:text-mantle border-surface2 w-8 h-8 p-0"
        >
          <Plus size={16} />
        </Button>
      </div>

      {todos.length === 0 && (
        <div className="text-center py-6 text-subtext0 text-sm">
          No tasks yet. Press N to add one.
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      <div className="mt-6 text-xs text-subtext0 text-center">
        <p>Play/Pause: Space • Volume: ± • Navigate: ↑↓ • Toggle: Enter • New: N • Delete: D • Edit: E</p>
      </div>
    </div>
  );
};

export default TodoList;
