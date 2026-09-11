# Hide n Seat 🎯

### Enterprise Gaze-Mitigation & Classroom Topology Optimization Engine

## Basic Details

### Team Name: ADIDAS

### Team Members
- Team Lead: Devadarsana R - College of Engineering Chengannur
- Member 2: Sara Shaji - College of Engineering Chengannur

### Project Description
Hide n Seat is a real-time computer vision system that solves the eternal student dilemma — where to sit so the teacher never looks at or calls on you. It scans a live classroom feed, detects every chair and person, scores each seat's "detection risk" out of 100, and even runs a musical-chairs mini-game that assigns the safest available seat to anyone walking in late.

## The Problem (that doesn't exist)
Every student intuitively knows some seats are "safer" than others — back rows, blind spots, seats blocked by a tall classmate — but nobody has ever rigorously quantified this. Students have been making this critical life decision on vibes alone, with zero data-driven backing. Unacceptable.

## The Solution (that nobody asked for)
A live webcam feed running real object detection identifies every chair and person in the room, computes a genuine line-of-sight visibility score for each seat factoring in the teacher's position and occlusion from other people ("Meat Shields") sitting in the way, and displays it directly on the video feed as a color-coded, emoji-rated badge (😎 low risk → 🫣 maximum exposure). A second screen turns entering-class into an actual musical-chairs game: music plays, a hat graphic hops between detected chairs, and when the music stops the system allots the safest currently-vacant seat to whoever just walked in — complete with a dramatic reveal, a confirm-or-reroll option, and a system that eventually just tells you to sit down already.

## Technical Details

### Technologies/Components Used

**For Software:**
- Languages: TypeScript, JavaScript
- Frameworks: React, Vite
- Libraries: TensorFlow.js, COCO-SSD (object detection — `chair` and `person` classes)
- Tools: Kiro (spec-driven IDE), browser SpeechSynthesis API (for system voice alerts), HTML5 Canvas/SVG (live overlay rendering)

## Implementation

### For Software:

#### Installation
```bash
git clone [your-repo-url]
cd hide-n-seat
npm install
```

#### Run
```bash
npm run dev
```
Open the local URL shown in the terminal (typically `http://localhost:5173`) in a browser, and grant camera permission when prompted.

## Project Documentation

### For Software:

#### Screenshots
![Screenshot1](Add screenshot here)
*Add caption explaining what this shows*

## Project Demo

### Video
[Add your demo video link here]
