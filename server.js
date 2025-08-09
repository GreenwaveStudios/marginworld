// Add these near the top of your server.js, before any usage:
// Add these near the top, after config loading:
const BONZI_COLORS = [
    "black", "blue", "brown", "green", "purple", "red", "pink", "cyan", "yellow", "scot", "doggiskill", "fakepope", "pingu"
];
const BONZI_ADMIN_COLORS = [
    "pope", "gold", "rgb", "giygas", "hollowpurple", "diogo", "soldier"
];

// In the 'color' command, restrict admin-only colors:


// Now, to add a new color for everyone, add it to BONZI_COLORS and place the PNG in ./img/bonzi/
// To add a new admin-only color, add it to BONZI_ADMIN_COLORS and place the PNG in ./img/bonzi/
const express = require('express');
const path = require('path');
const http = require('http');
const socketio = require('socket.io');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 80;

const frontendDir = path.join(__dirname, 'frontend');

// IP tracking and limits
const ipConnections = new Map(); // Tracks active socket IDs per IP
const ipAlts = new Map(); // Tracks total alt count per IP (persists after disconnect)
const MAX_ALTS = 450;  // Maximum alts per IP

// Cleanup function to remove old IP entries
function cleanupIpAlts() {
  const now = Date.now();
  for (const [ip, data] of ipAlts.entries()) {
    // Remove entries older than 1 hour
    if (now - data.lastSeen > 3600000) {
      ipAlts.delete(ip);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupIpAlts, 3600000);

// Enable CORS for all routes (for development)
app.use(cors());

// Serve static files (css, js, images, fonts, etc.)
app.use(express.static(frontendDir));

// Serve index.html for the root
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Create HTTP server and attach socket.io
const server = http.createServer(app);
const io = socketio(server);

// Allow all origins for socket.io (v1.x way)
io.set('origins', '*:*');

// In-memory user and room tracking
const rooms = {};

// Load or create config file
let config = {
    godmode_password: "bonzi"
};

const configPath = path.join(__dirname, 'config', 'config.json');
const bansPath = path.join(__dirname, 'bans.json');

try {
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
    }
} catch (err) {
    console.error('Error loading config:', err);
}

// Load or create bans file
let bans = [];
try {
    if (fs.existsSync(bansPath)) {
        bans = JSON.parse(fs.readFileSync(bansPath, 'utf8'));
    } else {
        fs.writeFileSync(bansPath, JSON.stringify(bans, null, 4));
    }
} catch (err) {
    console.error('Error loading bans:', err);
}

// Function to save bans to file
function saveBans() {
    try {
        fs.writeFileSync(bansPath, JSON.stringify(bans, null, 4));
    } catch (err) {
        console.error('Error saving bans:', err);
    }
}

// Function to check if a user is banned
function checkBan(ip) {
    const now = new Date();
    // Clean up expired bans while we're at it
    bans = bans.filter(ban => new Date(ban.end) > now);
    saveBans();
    
    // Check for active ban
    const ban = bans.find(ban => 
        ban.ip === ip && 
        new Date(ban.end) > now
    );
    return ban || null;
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  // Get real IP from headers or socket
  const clientIp = socket.handshake.headers['x-real-ip'] || 
                   socket.handshake.headers['x-forwarded-for'] || 
                   socket.handshake.address;
                   
  // Initialize IP tracking
  if (!ipConnections.has(clientIp)) {
    ipConnections.set(clientIp, new Set());
  }
  
  // Initialize or update IP alts tracking
  if (!ipAlts.has(clientIp)) {
    ipAlts.set(clientIp, {
      count: 0,
      lastSeen: Date.now()
    });
  }
  
  // Update last seen time
  ipAlts.get(clientIp).lastSeen = Date.now();
  
  // Check alt limit
  if (ipAlts.get(clientIp).count >= MAX_ALTS) {
    socket.emit('errr', {
      code: 105,
      limit: MAX_ALTS
    });
    socket.disconnect();
    return;
  }
  
  // Add this connection to IP tracking
  ipConnections.get(clientIp).add(socket.id);
  ipAlts.get(clientIp).count++;
  
  // Send current alt count
  socket.emit('stats', {
    climit: `${ipAlts.get(clientIp).count}/${MAX_ALTS}`
  });

  socket.on('login', function(data) {
    // Minimal validation
    const name = (data.name || '').trim().substring(0, 32) || 'Anonymous';
    const room = (data.room || 'main').trim();
    const guid = socket.id;

    // Check for ban if trying to join public room
    if (room === 'main') {
      const ban = checkBan(clientIp);
      if (ban) {
        socket.emit('ban', {
          reason: ban.reason,
          end: ban.end
        });
        return;
      }
    }

const userPublic = {
    name: name,
    color: BONZI_COLORS[Math.floor(Math.random() * BONZI_COLORS.length)], // Default color
    guid: guid,
    speed: Math.floor(Math.random() * (275 - 125 + 1)) + 125, // Random speed between 125 and 275
    pitch: Math.floor(Math.random() * (125 - 15 + 1)) + 15,   // Random pitch between 15 and 125
    voice: 'en-uk'
};

    // Join room
    socket.join(room);
    if (!rooms[room]) rooms[room] = {};
    rooms[room][guid] = userPublic;
    socket.room = room;
    socket.guid = guid;

    // Send room info
    socket.emit('room', {
      isOwner: Object.keys(rooms[room]).length === 1,
      isPublic: room === 'main',
      room: room
    });
    // Send all users in the room
    socket.emit('updateAll', {
      usersPublic: rooms[room]
    });
    // Notify others in the room
    socket.to(room).emit('update', {
      guid: guid,
      userPublic: userPublic
    });
  });

  socket.on('talk', function(data) {
    const room = socket.room;
    const guid = socket.guid;
    if (room && guid && typeof data.text === 'string') {
      io.to(room).emit('talk', {
        guid: guid,
        text: data.text
      });
    }
  });

  socket.on('command', function(data) {
    if (!Array.isArray(data.list) || data.list.length === 0) return;
    const cmd = (data.list[0] || '').toLowerCase();
    const args = data.list.slice(1);
    const room = socket.room;
    const guid = socket.guid;
    if (!room || !guid || !rooms[room] || !rooms[room][guid]) return;
    const userPublic = rooms[room][guid];

    switch (cmd) {
      case 'asshole':
        // args[0] = target name
        io.to(room).emit('asshole', { guid, target: args[0] || '' });
        break;

          case 'stfu':
        // args[0] = target name
        io.to(room).emit('stfu', { guid, target: args[0] || '' });
        break;

             case 'ground':
        // args[0] = target name
        io.to(room).emit('ground', { guid, target: args[0] || '' });
        break;

      case 'owo':
        io.to(room).emit('owo', { guid, target: args[0] || '' });
        break;
           case 'name':
        if (args.length > 0) {
          // Join all arguments to allow spaces in the name
          userPublic.name = args.join(' ').substring(0, 50);
          io.to(room).emit('update', { guid, userPublic });
        }
        break;
    case 'color':
    if (args[0]) {
        const requestedColor = args[0].toLowerCase();
        const isAdmin = !!rooms[room][guid].admin;
        const allowedColors = isAdmin ? BONZI_COLORS.concat(BONZI_ADMIN_COLORS) : BONZI_COLORS;
        if (allowedColors.includes(requestedColor)) {
            userPublic.color = requestedColor;
            io.to(room).emit('update', { guid, userPublic });
        } else {
            socket.emit('alert', { text: 'The color you tried to use is for admins only.' });
        }
    }
    break;
      case 'youtube':
        if (args[0]) {
          io.to(room).emit('youtube', { guid, vid: args[0] });
        }
        break;
      case 'joke':
        // Optionally randomize a seed for joke selection
        io.to(room).emit('joke', { guid, rng: Math.random().toString() });
        break;
      case 'fact':
        io.to(room).emit('fact', { guid, rng: Math.random().toString() });
        break;
      case 'backflip':
        // args[0] can be a flag for 'swag' (optional)
        io.to(room).emit('backflip', { guid, swag: !!args[0] });
        break;
      case 'triggered':
        io.to(room).emit('triggered', { guid });
        break;
      case 'linux':
        io.to(room).emit('linux', { guid });
        break;
            
      case 'bye':
        // Just play the leave animation for this user's Bonzi, do not remove from room or disconnect
        io.to(room).emit('leave', { guid: guid });
        // After 7 seconds, make the Bonzi reappear as 'Traumatized Bonzi'
        setTimeout(() => {
          if (room && rooms[room] && rooms[room][guid]) {
            rooms[room][guid].name = 'Traumatized Bonzi';
            io.to(room).emit('update', { guid, userPublic: rooms[room][guid] });
          }
        }, 7000);
        break;
      case 'godmode':
        // Check password for godmode command
        if (!args[0]) {
          socket.emit('alert', { text: 'Did you try password?' });
          break;
        }
        if (args[0] !== config.godmode_password) {
          socket.emit('alert', { text: 'Did you try password?' });
          break;
        }
        // Enable admin privileges for this user
        if (rooms[room][guid]) {
          rooms[room][guid].admin = true;
          // Update the user's public info to show they're an admin
          io.to(room).emit('update', { guid, userPublic: rooms[room][guid] });
          // Send admin status to the client
          socket.emit('admin', { admin: true });
        }
        break;
      case 'pope':
        // Check if user has admin privileges before allowing pope color
        if (!rooms[room][guid].admin) {
          socket.emit('alert', { text: 'none' });
          break;
        }
        if (rooms[room][guid]) {
          rooms[room][guid].color = 'pope';
          io.to(room).emit('update', { guid, userPublic: rooms[room][guid] });
        }
        break;
      case 'kick':
        console.log('Kick command received:', {
          sender: guid,
          hasAdmin: rooms[room][guid].admin,
          target: args[0],
          reason: args.slice(1).join(' ')
        });
        // Check if user has godmode
        if (!rooms[room][guid].admin) {
          socket.emit('alert', { text: 'Did you try password?' });
          break;
        }
        // Find the target user by name
        const kickTargetGuid = Object.keys(rooms[room]).find(key => 
          rooms[room][key].name.toLowerCase() === args[0].toLowerCase()
        );
        console.log('Found kick target:', kickTargetGuid);
        if (kickTargetGuid && kickTargetGuid !== guid) {
          const reason = args.slice(1).join(' ') || 'No reason provided';
          // Send kick event to target and leave event to others
          io.to(kickTargetGuid).emit('kick', {
            guid: kickTargetGuid,
            reason: reason
          });
          // Remove user from room
          delete rooms[room][kickTargetGuid];
          // Notify everyone they left
          io.to(room).emit('leave', { guid: kickTargetGuid });
          console.log('Kick executed successfully');
        }
        break;
      case 'ban':
        // Check if user has godmode
        if (!rooms[room][guid].admin) {
          socket.emit('alert', { text: 'Did you try password?' });
          break;
        }
        // Find the target user by name
        const banTargetGuid = Object.keys(rooms[room]).find(key => 
          rooms[room][key].name.toLowerCase() === args[0].toLowerCase()
        );
        console.log('Found ban target:', banTargetGuid);
        if (banTargetGuid && banTargetGuid !== guid) {
          const reason = args.slice(1).join(' ') || 'No reason provided';
          const banEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hour ban
          
          // Get target's IP from connected sockets
          let targetIp = null;
          Object.keys(io.sockets.connected).forEach(socketId => {
            if (socketId === banTargetGuid) {
              const targetSocket = io.sockets.connected[socketId];
              targetIp = targetSocket.handshake.headers['x-real-ip'] || 
                        targetSocket.handshake.headers['x-forwarded-for'] || 
                        targetSocket.handshake.address;
            }
          });

          if (targetIp) {
            // Add to persistent bans with IP
            bans.push({
              ip: targetIp,
              name: rooms[room][banTargetGuid].name, // Keep name for reference
              reason: reason,
              end: banEnd,
              bannedBy: rooms[room][guid].name,
              bannedAt: new Date().toISOString()
            });
            saveBans();

            // Notify all sockets from this IP about the ban
            Object.keys(io.sockets.connected).forEach(socketId => {
              const connectedSocket = io.sockets.connected[socketId];
              const socketIp = connectedSocket.handshake.headers['x-real-ip'] || 
                              connectedSocket.handshake.headers['x-forwarded-for'] || 
                              connectedSocket.handshake.address;
              
              if (socketIp === targetIp) {
                // Only remove them if they're in the main room
                const socketRoom = connectedSocket.room;
                const socketGuid = connectedSocket.guid;
                if (socketRoom === 'main' && rooms[socketRoom] && rooms[socketRoom][socketGuid]) {
                  delete rooms[socketRoom][socketGuid];
                  // Clean up empty rooms
                  if (Object.keys(rooms[socketRoom]).length === 0) {
                    delete rooms[socketRoom];
                  }
                  io.to(socketRoom).emit('leave', { guid: socketGuid });
                }
                
                // Notify them about the ban
                connectedSocket.emit('ban', {
                  guid: banTargetGuid,
                  reason: reason,
                  end: banEnd
                });
              }
            });

            console.log('Ban executed successfully');
          }
        }
        break;
      case 'pitch':
        if (args[0]) {
          let newPitch = parseInt(args[0], 10);
          if (isNaN(newPitch)) {
            socket.emit('alert', { text: 'Pitch must be a number.' });
            break;
          }
          if (newPitch < 15) newPitch = 15;
          if (newPitch > 125) newPitch = 125;
          userPublic.pitch = newPitch;
          io.to(room).emit('update', { guid, userPublic });
        }
        break;
      // For now we're just gonna end this command list here
    }
  });

  socket.on('disconnect', function() {
    // Remove from active connections tracking and reset IP count
    if (ipConnections.has(clientIp)) {
      ipConnections.get(clientIp).delete(socket.id);
      if (ipConnections.get(clientIp).size === 0) {
        ipConnections.delete(clientIp);
        // Reset alt count when all connections are gone
        if (ipAlts.has(clientIp)) {
          ipAlts.delete(clientIp);
        }
      }
    }

    const room = socket.room;
    const guid = socket.guid;
    if (room && rooms[room] && rooms[room][guid]) {
      // Remove user
      delete rooms[room][guid];
      // Notify others
      socket.to(room).emit('leave', { guid: guid });
      // Clean up empty rooms
      if (Object.keys(rooms[room]).length === 0) {
        delete rooms[room];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
