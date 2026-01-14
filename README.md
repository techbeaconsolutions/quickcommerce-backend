# 🛒 Quick Commerce Compare API (Backend)

This is the backend service that powers the **Quick Commerce Compare App**, built using Node.js and Express.

It scrapes real-time product data from Blinkit, Zepto, Swiggy Instamart, and JioMart, matches similar items, and returns structured results for comparison.

---

## 🚀 Features
- Scrapes multiple platforms in parallel  
- Matches similar products using fuzzy logic  
- Returns unified JSON for easy comparison  
- Ready to host on Render / Railway / Azure  

---

## 🧩 Tech Stack
- Node.js + Express
- Playwright (for scraping)
- Fuse.js (for fuzzy matching)
- Axios (for API requests)
- CORS-enabled for frontend apps

---

## ⚙️ API Endpoint
**GET** `/compare?product=<product>&pincode=<pincode>`

**Example:**
