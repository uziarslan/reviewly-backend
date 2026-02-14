# Reviewly Backend

Node.js + Express + MongoDB backend for Reviewly exam review platform.

## Setup

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Configure environment
Copy `.env` and fill in your values:
- `MONGO_URI` – MongoDB connection string (local or Atlas)
- `GOOGLE_CLIENT_ID` – From [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- `JWT_SECRET` – A strong random secret

### 3. Google OAuth Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Go to **APIs & Services** → **Credentials**
4. Create an **OAuth 2.0 Client ID** (Web application)
5. Add authorized JavaScript origins:
   - `http://localhost:3000` (frontend dev)
   - `http://localhost:5000` (backend dev)
6. Copy the **Client ID** and set it in:
   - `backend/.env` as `GOOGLE_CLIENT_ID`
   - `frontend/.env` as `REACT_APP_GOOGLE_CLIENT_ID`

### 4. Seed the database
```bash
# Seed reviewers (8 exam types)
npm run seed:reviewers

# Seed questions (place your questions.xlsx in seeds/data/ first)
npm run seed:questions

# Or seed everything at once
npm run seed:all
```

### 5. Run the server
```bash
# Development (with hot reload)
npm run dev

# Production
npm start
```

## API Endpoints

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/google` | No | Login with Google ID token |
| GET | `/api/auth/me` | Yes | Get current user |
| PUT | `/api/auth/me` | Yes | Update profile |
| POST | `/api/auth/logout` | Yes | Logout |

### Reviewers
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/reviewers` | No | Get all published reviewers |
| GET | `/api/reviewers/:id` | No | Get reviewer by ID |
| GET | `/api/reviewers/slug/:slug` | No | Get reviewer by slug |

### Library (Bookmarks)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/library` | Yes | Get user's bookmarked reviewers |
| POST | `/api/library/:reviewerId` | Yes | Bookmark a reviewer |
| DELETE | `/api/library/:reviewerId` | Yes | Remove bookmark |

### Exams
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/exams/:reviewerId/start` | Yes | Start exam (generates questions) |
| PUT | `/api/exams/attempts/:id/answer` | Yes | Save an answer |
| PUT | `/api/exams/attempts/:id/pause` | Yes | Pause exam |
| POST | `/api/exams/attempts/:id/submit` | Yes | Submit exam for grading |
| GET | `/api/exams/attempts/:id` | Yes | Get attempt result |
| GET | `/api/exams/attempts/:id/review` | Yes | Full review with answers |
| GET | `/api/exams/attempts/user/history` | Yes | User's attempt history |

## Database Models

- **User** – Google profile, library bookmarks, subscription
- **Reviewer** – Exam types with config (section distribution, difficulty, time limit)
- **Question** – 1000+ questions with difficulty, section, explanations
- **Attempt** – User exam sessions with answers, scores, section breakdown

## Exam Assembly Logic

| Exam Type | Items | Time | Variant |
|-----------|-------|------|---------|
| Professional Mock | 170 | 3h 10m | Dynamic |
| Sub-Professional Mock | 165 | 2h 40m | Dynamic |
| Section Practice | 50 | ~40-45m | Dynamic |
| Demo | 20 | No limit | Fixed |

Dynamic exams: randomly select questions per section → apply difficulty distribution (30% easy / 50% medium / 20% hard) → shuffle.

Fixed exams (demo): same 20 questions every time.
