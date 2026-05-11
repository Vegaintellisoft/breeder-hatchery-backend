# 🐔 KRISHI - Breeder Daily Entry API

Node.js + Express + PostgreSQL API for Breeder Daily Entry management.

---

## 🚀 Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your PostgreSQL credentials
```

### 3. Run migration (creates tables + seeds flocks with opening stock)
```bash
node migration/run.js
```

### 4. Start server
```bash
npm start          # production
npm run dev        # development (nodemon)
```

---

## 📦 Seeded Flocks (Opening Stock from SAP placeholder)

| Flock No | Unit   | Breed       | Male Opening | Female Opening |
|----------|--------|-------------|:------------:|:--------------:|
| FL-001   | Unit A | Ross 308    | 500          | 4500           |
| FL-002   | Unit A | Cobb 500    | 480          | 4320           |
| FL-003   | Unit B | Ross 308    | 520          | 4680           |
| FL-004   | Unit B | Hubbard F15 | 460          | 4140           |
| FL-005   | Unit C | Cobb 500    | 510          | 4590           |
| FL-006   | Unit C | Ross 308    | 495          | 4455           |

---

## 📡 API Reference

### GET /api/breeder/units
List all active units.

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "unit_name": "Unit A", "location": "Farm Block 1" }
  ]
}
```

---

### GET /api/breeder/flocks
List all active flocks with opening stock values.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "flock_no": "FL-001",
      "breed": "Ross 308",
      "start_date": "2023-01-10",
      "male_opening_stock": 500,
      "female_opening_stock": 4500,
      "unit_name": "Unit A",
      "unit_id": 1
    }
  ]
}
```

---

### GET /api/breeder/flock/:flock_id/opening-stock?entry_date=YYYY-MM-DD
**Called when user selects a flock on the form.**
Returns male & female opening stock for that flock on the given date.

- If a previous day's entry exists → returns that day's **closing stock** as opening stock
- If no previous entry → returns **SAP seeded opening stock** from flocks table

**Example:**
```
GET /api/breeder/flock/1/opening-stock?entry_date=2024-09-23
```

**Response:**
```json
{
  "success": true,
  "source": "sap_seed",
  "flock_no": "FL-001",
  "unit_id": 1,
  "unit_name": "Unit A",
  "data": {
    "male_opening_stock": 500,
    "female_opening_stock": 4500
  }
}
```

---

### POST /api/breeder/entry
Save or update a daily breeder entry.  
**Closing stock is auto-calculated** by PostgreSQL — do not send it.

**Request Body:**
```json
{
  "unit_id": 1,
  "flock_id": 1,
  "entry_date": "2024-09-23",
  "day_name": "Monday",
  "week_label": "2nd Week",
  "age_years": 3,

  "male_opening_stock": 500,
  "male_mortality": 2,
  "male_culls_kill": 1,
  "male_culls_sale": 0,
  "male_transfer_in": 0,
  "male_transfer_out": 0,
  "male_sales": 0,

  "female_opening_stock": 4500,
  "female_mortality": 5,
  "female_culls_kill": 2,
  "female_culls_sale": 1,
  "female_transfer_in": 0,
  "female_transfer_out": 0,
  "female_sales": 0,

  "feeding_notes": "Fed 120g per bird, no issues",
  "shed_hygiene_notes": "Litter changed, cleaned east side",
  "body_weight_avg_kg": 3.125,
  "egg_collections": 23,

  "temp_min_celsius": 22.5,
  "temp_max_celsius": 30.0,
  "humidity_min": 55.0,
  "humidity_max": 75.0,
  "lighting_start": "05:00",
  "lighting_end": "21:00",

  "remarks": "All birds healthy"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Entry saved successfully",
  "data": {
    "id": 1,
    "flock_no": "FL-001",
    "entry_date": "2024-09-23",
    "male": {
      "opening_stock": 500,
      "mortality": 2,
      "culls_kill": 1,
      "culls_sale": 0,
      "transfer_in": 0,
      "transfer_out": 0,
      "sales": 0,
      "closing_stock": 497
    },
    "female": {
      "opening_stock": 4500,
      "mortality": 5,
      "culls_kill": 2,
      "culls_sale": 1,
      "transfer_in": 0,
      "transfer_out": 0,
      "sales": 0,
      "closing_stock": 4492
    },
    "total_closing_stock": 4989,
    "production": {
      "body_weight_avg_kg": 3.125,
      "egg_collections": 23
    },
    "environmental": {
      "temp_min_celsius": 22.5,
      "temp_max_celsius": 30.0
    }
  }
}
```

---

### GET /api/breeder/entry/:flock_id/:entry_date
Get a specific entry.

```
GET /api/breeder/entry/1/2024-09-23
```

---

### GET /api/breeder/entries/:flock_id
List all entries for a flock.

**Query params:** `from`, `to`, `limit`, `offset`

```
GET /api/breeder/entries/1?from=2024-09-01&to=2024-09-30&limit=30
```

---

## 🔢 Closing Stock Formula
```
closing_stock = opening_stock
              - mortality
              - culls_kill
              - culls_sale
              - transfer_out
              - sales
              + transfer_in
```
Calculated separately for **Male** and **Female**.

---

## 📁 Project Structure
```
breeder-api/
├── migration/
│   └── run.js              ← node migration/run.js
├── src/
│   ├── config/
│   │   └── db.js
│   ├── controllers/
│   │   └── breederController.js
│   ├── middleware/
│   │   └── validation.js
│   ├── routes/
│   │   └── breeder.js
│   └── server.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```
