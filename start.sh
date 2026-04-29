#!/bin/bash
# ZHL Operations Tool - Start Script

echo "Starting ZHL Operations Tool..."

# Start backend
cd backend
npm start &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID)"

# Start frontend dev server
cd ../frontend
npm run dev &
FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID)"

echo ""
echo "App running at: http://localhost:5173"
echo "Backend API at: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both servers"

wait
