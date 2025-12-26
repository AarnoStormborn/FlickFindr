import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import MoviesPage from './pages/MoviesPage';
import MovieDetailsPage from './pages/MovieDetailsPage';
import GenrePage from './pages/GenrePage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Navbar />
        <Routes>
          <Route path="/" element={<MoviesPage />} />
          <Route path="/movie/:id" element={<MovieDetailsPage />} />
          <Route path="/genre/:name" element={<GenrePage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
