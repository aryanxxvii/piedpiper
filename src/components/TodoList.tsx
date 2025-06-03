
import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TodoList: React.FC = () => {
  const [todos, setTodos] = useState([
    { id: 1, text: 'Listen to some lofi beats', completed: false },
    { id: 2, text: 'Focus on deep work', completed: false },
    { id: 3, text: 'Take a mindful break', completed: true },
  ]);
  const [newTodo, setNewTodo] = useState('');

  const addTodo = () => {
    if (newTodo.trim()) {
      setTodos([...todos, { 
        id: Date.now(), 
        text: newTodo.trim(), 
        completed: false 
      }]);
      setNewTodo('');
    }
  };

  const toggleTodo = (id: number) => {
    setTodos(todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter(todo => todo.id !== id));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      addTodo();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-mantle rounded-lg border border-surface0 p-6">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-mauve mb-2">## Focus Tasks</h2>
        <p className="text-sm text-subtext0">Keep track of what matters</p>
      </div>

      {/* Add new todo */}
      <div className="flex gap-2 mb-4">
        <Input
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Add a new task..."
          className="bg-surface0 border-surface2 text-text placeholder:text-subtext0"
        />
        <Button 
          onClick={addTodo}
          size="sm"
          className="bg-surface0 hover:bg-surface1 border-surface2"
        >
          <Plus size={16} />
        </Button>
      </div>

      {/* Todo list */}
      <div className="space-y-2">
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-center gap-3 p-2 rounded hover:bg-surface0 transition-colors">
            <button
              onClick={() => toggleTodo(todo.id)}
              className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                todo.completed 
                  ? 'bg-green border-green' 
                  : 'border-surface2 hover:border-subtext0'
              }`}
            >
              {todo.completed && (
                <span className="text-base text-xs">✓</span>
              )}
            </button>
            <span 
              className={`flex-1 text-sm ${
                todo.completed 
                  ? 'text-subtext0 line-through' 
                  : 'text-text'
              }`}
            >
              {todo.text}
            </span>
            <button
              onClick={() => deleteTodo(todo.id)}
              className="text-subtext0 hover:text-red transition-colors opacity-0 group-hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {todos.length === 0 && (
        <div className="text-center py-6 text-subtext0 text-sm">
          No tasks yet. Add one above to get started.
        </div>
      )}
    </div>
  );
};

export default TodoList;
