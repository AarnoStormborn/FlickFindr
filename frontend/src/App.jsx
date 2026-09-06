import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import MoviesPage from './pages/MoviesPage';
import MovieDetailsPage from './pages/MovieDetailsPage';
import GenrePage from './pages/GenrePage';
import EraPage from './pages/EraPage';
import SearchPage from './pages/SearchPage';
import ListsPage from './pages/ListsPage';
import { ListsProvider } from './context/ListsContext';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <ListsProvider>
        <div className="app">
          <Navbar />
          <Routes>
            <Route path="/" element={<MoviesPage />} />
            <Route path="/movies" element={<MoviesPage />} />
            <Route path="/movie/:id" element={<MovieDetailsPage />} />
            <Route path="/genre/:name" element={<GenrePage />} />
            <Route path="/era/:id" element={<EraPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/lists" element={<ListsPage />} />
          </Routes>
        </div>
      </ListsProvider>
    </BrowserRouter>
  );
}

export default App;
