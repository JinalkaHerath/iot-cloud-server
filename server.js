
// server.js - Cloud IoT Server
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Enable CORS for all origins (for global access)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store connected IoT devices and web clients separately
const iotDevices = new Map(); // Connected IoT devices
const webClients = new Map(); // Connected web dashboard clients

// Device states - this would typically be in a database
let deviceStates = {
    temperature: 24.5,
    humidity: 68,
    led: false,
    pump: false,
    fanSpeed: 45,
    power: 156,
    lastUpdate: new Date().toISOString()
};

// Device registry
let registeredDevices = [
    { 
        id: 'device_001', 
        name: 'Kitchen Sensor', 
        type: 'sensor',
        location: 'Kitchen', 
        online: false,
        lastSeen: null
    },
    { 
        id: 'device_002', 
        name: 'LED Controller', 
        type: 'actuator',
        location: 'Living Room', 
        online: false,
        lastSeen: null
    }
];

// API Routes for Web Dashboard
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'online', 
        timestamp: new Date().toISOString(),
        connectedDevices: iotDevices.size,
        connectedClients: webClients.size
    });
});

app.get('/api/devices', (req, res) => {
    res.json(registeredDevices);
});

app.get('/api/sensors', (req, res) => {
    res.json(deviceStates);
});

// Control endpoint - receives commands from web dashboard
app.post('/api/devices/:deviceId/control', (req, res) => {
    const { deviceId } = req.params;
    const { command, value } = req.body;
    
    console.log(`📱 Web Command: Device ${deviceId} - ${command}: ${value}`);
    
    const deviceWs = iotDevices.get(deviceId);
    
    if (deviceWs && deviceWs.readyState === WebSocket.OPEN) {
        const commandMessage = {
            type: 'command',
            command: command,
            value: value,
            timestamp: new Date().toISOString()
        };
        
        deviceWs.send(JSON.stringify(commandMessage));
        
        if (deviceStates.hasOwnProperty(command)) {
            deviceStates[command] = value;
        }
        
        broadcastToWebClients({
            type: 'stateUpdate',
            deviceId: deviceId,
            command: command,
            value: value,
            timestamp: new Date().toISOString()
        });
        
        res.json({ 
            success: true, 
            message: `Command sent to ${deviceId}`,
            command: command,
            value: value
        });
    } else {
        res.status(404).json({ 
            success: false, 
            error: `Device ${deviceId} is not connected` 
        });
    }
});

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientType = url.searchParams.get('type');
    const deviceId = url.searchParams.get('deviceId');
    
    if (clientType === 'device' && deviceId) {
        console.log(`🔌 IoT Device connected: ${deviceId}`);
        iotDevices.set(deviceId, ws);
        
        const device = registeredDevices.find(d => d.id === deviceId);
        if (device) {
            device.online = true;
            device.lastSeen = new Date().toISOString();
        }
        
        ws.send(JSON.stringify({
            type: 'config',
            message: 'Connected to cloud server',
            deviceId: deviceId
        }));
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log(`📊 Data from ${deviceId}:`, data);
                
                if (data.type === 'sensorData') {
                    Object.assign(deviceStates, data.data);
                    deviceStates.lastUpdate = new Date().toISOString();
                    
                    broadcastToWebClients({
                        type: 'sensorUpdate',
                        deviceId: deviceId,
                        data: data.data,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error('Error parsing device message:', error);
            }
        });
        
        ws.on('close', () => {
            console.log(`🔌 IoT Device disconnected: ${deviceId}`);
            iotDevices.delete(deviceId);
            
            const device = registeredDevices.find(d => d.id === deviceId);
            if (device) {
                device.online = false;
                device.lastSeen = new Date().toISOString();
            }
            
            broadcastToWebClients({
                type: 'deviceDisconnected',
                deviceId: deviceId,
                timestamp: new Date().toISOString()
            });
        });
        
    } else if (clientType === 'web') {
        const clientId = Math.random().toString(36).substring(7);
        console.log(`💻 Web Client connected: ${clientId}`);
        webClients.set(clientId, ws);
        
        ws.send(JSON.stringify({
            type: 'initialData',
            devices: registeredDevices,
            sensors: deviceStates,
            timestamp: new Date().toISOString()
        }));
        
        ws.on('close', () => {
            console.log(`💻 Web Client disconnected: ${clientId}`);
            webClients.delete(clientId);
        });
        
    } else {
        ws.close(1008, 'Invalid client type');
    }
});

function broadcastToWebClients(data) {
    webClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function broadcastToIotDevices(data) {
    iotDevices.forEach((device) => {
        if (device.readyState === WebSocket.OPEN) {
            device.send(JSON.stringify(data));
        }
    });
}

app.get('/api/ping', (req, res) => {
    res.json({ message: 'Server is running', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 IoT Cloud Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
    console.log('Shutting down server...');
    server.close(() => {
        process.exit(0);
    });
});

setInterval(() => {
    console.log(`💓 Server heartbeat - Devices: ${iotDevices.size}, Clients: ${webClients.size}`);
}, 30000);
