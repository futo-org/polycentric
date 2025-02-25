import { useState } from 'react';
import { setupDarkMode } from './setupDarkMode';

export const DarkModeSelector = () => {
  const [darkMode, setDarkMode] = useState(
    localStorage.getItem('darkMode') || 'auto',
  );

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setDarkMode(value);
    localStorage.setItem('darkMode', value);
    setupDarkMode();
  };

  return (
    <div className="flex items-center space-x-3 py-3 px-6 rounded-full border">
      <label htmlFor="darkMode" className="text-sm font-medium text-gray-900">
        Dark Mode
      </label>
      <select
        id="darkMode"
        value={darkMode}
        onChange={handleChange}
        className="text-sm font-medium text-gray-900 px-3 py-1 border rounded-full bg-white"
      >
        <option value="on">On</option>
        <option value="off">Off</option>
        <option value="auto">Auto</option>
      </select>
    </div>
  );
};
