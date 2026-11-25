import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp.jsx';
import './styles.css';

const root = createRoot(document.getElementById('root'));
root.render(<AdminApp />);
