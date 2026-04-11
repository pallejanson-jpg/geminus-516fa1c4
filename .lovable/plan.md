

# LinkedIn Carousel PDF — Geminus Product Overview

## What's being created
A **10-slide PDF (1080×1080 px)** LinkedIn carousel presenting Geminus as a digital twin platform for facility management. All text in **English**.

## Slide content

| # | Content |
|---|---------|
| 1 | **Cover** — "GEMINUS" + "The Digital Twin Platform for Facility Management" |
| 2 | **The Problem** — Buildings live 50–100 years, but data dies at handover |
| 3 | **The Solution** — One platform connecting BIM, IoT & AI |
| 4 | **3D Digital Twin** — Screenshot from Småviken 3D viewer + short description |
| 5 | **AI-Powered Features** — List with icons: Predictive Maintenance, AI-Assisted Inventory, Room Optimization, Energy Optimization, RAG Document Search, Geminus AI Chat |
| 6 | **Predictive AI** — Screenshot from Predictive Maintenance tab + explanation |
| 7 | **AI Inventory** — Camera scan flow + automatic BIP classification |
| 8 | **IoT & Real-Time Data** — Sensor data visualized in the 3D model |
| 9 | **ROI / Key Metrics** — Large numbers: time savings, cost reduction |
| 10 | **CTA** — "Transform Your Buildings" + contact info |

## Visual style
- Dark background (#0c1221 → #0c1e2e) with cyan accent (#22d3ee)
- Screenshots from Småviken with rounded corners and subtle shadow
- Clean sans-serif typography, large headings, generous whitespace

## Steps
1. Capture 2–3 screenshots from the Småviken building in the app (3D viewer, AI chat, predictive maintenance)
2. Generate PDF with Python (reportlab), embedding screenshots
3. QA every page via pdftoppm inspection
4. Save to `/mnt/documents/geminus-linkedin-carousel.pdf`

