// Client helper (used by movies and owner upload page)
async function getMovies(){
  const res = await fetch('/api/movies');
  return await res.json();
}

// Example usage: getMovies().then(m=>console.log(m));
