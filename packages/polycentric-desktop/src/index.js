import React from 'react';
import { createRoot } from 'react-dom/client';
import { render } from 'react-dom';
import App from './components/App';

let rootElement = document.createElement('div');

rootElement.id = 'root';
document.body.appendChild(rootElement);

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
