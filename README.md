# Spotify-Album--Synced-Lights-

A Node.js application that syncs **Govee smart lights** with Spotify playback by analyzing album art colors. The lights update in real-time to reflect the dominant color of the current track’s album cover, creating a dynamic and immersive music-listening experience.

## Features
- 🎵 **Spotify Integration** – Uses Spotify Web API with OAuth 2.0 for secure authentication and real-time playback tracking.  
- 🌈 **Album Art Color Extraction** – Leverages ColorThief to analyze album covers and detect dominant colors.  
- 💡 **Smart Light Control** – Communicates with the Govee Cloud API to update light color and brightness dynamically.  
- ⚡ **Smooth Transitions** – Ensures natural, visually appealing lighting updates during track changes.  

## Tech Stack
- **Node.js** (server & API handling)  
- **Express.js** (web server & routing)  
- **Spotify Web API** (real-time playback data)  
- **Govee API** (smart light control)  
- **ColorThief** (image color extraction)  

## Setup
1. Clone the repository:  
   ```bash
   git clone https://github.com/yourusername/Spotify-Album--Synced-Lights-.git
   cd Spotify-Album--Synced-Lights-
Install dependencies:

bash
Copy code
npm install
Create a .env file in the project root and add your credentials:

env
Copy code
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8080/callback
GOVEE_API_KEY=your_govee_api_key
GOVEE_DEVICE=your_govee_device_id
GOVEE_MODEL=your_govee_device_model
Start the server:


node auth-and-sync.js
Open http://127.0.0.1:8080/login in your browser to authorize with Spotify.

Demo
Lights automatically sync to Spotify playback, reflecting album art colors in real-time.
(GIF or screenshot demo recommended here)

License
This project is licensed under the MIT License.








Ask ChatGPT
