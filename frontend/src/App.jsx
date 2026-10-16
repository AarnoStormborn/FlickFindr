import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import MoviesPage from './pages/MoviesPage';
import MovieDetailsPage from './pages/MovieDetailsPage';
import GenrePage from './pages/GenrePage';
import EraPage from './pages/EraPage';
import MoodPage from './pages/MoodPage';
import SearchPage from './pages/SearchPage';
import ListsPage from './pages/ListsPage';
import AccountPage from './pages/AccountPage';
import ChatPage from './pages/ChatPage';
import { ListsProvider } from './context/ListsContext';
import { AuthProvider } from './context/AuthProvider';
import { CloudSyncProvider } from './context/CloudSyncProvider';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
      <CloudSyncProvider>
      <ListsProvider>
        <div className="app">
          <Navbar />
          <Routes>
            <Route path="/" element={<MoviesPage />} />
            <Route path="/movies" element={<MoviesPage />} />
            <Route path="/movie/:id" element={<MovieDetailsPage />} />
            <Route path="/genre/:name" element={<GenrePage />} />
            <Route path="/era/:id" element={<EraPage />} />
            <Route path="/mood/:id" element={<MoodPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/lists" element={<ListsPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Routes>
        </div>
      </ListsProvider>
      </CloudSyncProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
