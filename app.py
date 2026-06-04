from flask import Flask, render_template, request, jsonify
import os
from pathlib import Path

app = Flask(__name__)

# Load environment variables from a local .env file if present.
def load_env_file(env_path=".env"):
    path = Path(env_path)
    if not path.is_file():
        return
    with path.open() as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env_file()

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    firebase_admin = None

# Build Firebase web config from environment variables.
def get_firebase_config():
    return {
        "apiKey": os.getenv("FIREBASE_API_KEY", ""),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
        "projectId": os.getenv("FIREBASE_PROJECT_ID", ""),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", ""),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID", ""),
        "appId": os.getenv("FIREBASE_APP_ID", ""),
        "measurementId": os.getenv("FIREBASE_MEASUREMENT_ID", "")
    }

# Initialize Firestore
try:
    if firebase_admin is None:
        raise RuntimeError("firebase_admin is not installed")

    service_account_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or os.getenv("FIREBASE_SERVICE_ACCOUNT") or "firebase-key.json"
    if not Path(service_account_path).is_file():
        raise FileNotFoundError(f"Firebase service account file not found: {service_account_path}")

    cred = credentials.Certificate(service_account_path)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Successfully connected to Firestore!")
except Exception as e:
    print("Firebase unavailable. Running application using local UTD CS catalog.")
    print("Reason:", e)
    db = None

UTD_CS_CATALOG = {
    "CS1436": {"title": "Programming Fundamentals", "credits": 4, "prereqs": []},
    "CS1337": {"title": "Computer Science I", "credits": 3, "prereqs": ["CS1436"]},
    "CS2305": {"title": "Discrete Mathematics I", "credits": 3, "prereqs": []},
    "CS2336": {"title": "Computer Science II", "credits": 3, "prereqs": ["CS1337"]},
    "CS3305": {"title": "Discrete Mathematics II", "credits": 3, "prereqs": ["CS2305"]},
    "CS3345": {"title": "Data Structures & Algorithmic Analysis", "credits": 3, "prereqs": ["CS2336", "CS2305"]},
    "CS3377": {"title": "C/C++ in a UNIX Environment", "credits": 3, "prereqs": ["CS2336"]},
    "CS4340": {"title": "Computer Architecture", "credits": 3, "prereqs": ["CS3345", "CS3377"]},
    "CS4349": {"title": "Advanced Algorithm Design", "credits": 3, "prereqs": ["CS3345", "CS3305"]}
}

def load_courses():
    if not db:
        return UTD_CS_CATALOG
    try:
        courses = {}
        docs = db.collection("courses").stream()
        for doc in docs:
            courses[doc.id] = doc.to_dict()
        return courses if courses else UTD_CS_CATALOG
    except Exception:
        return UTD_CS_CATALOG

def kahn_topological_sort(completed_courses, max_credits):
    catalog = load_courses()
    in_degree = {}
    adjacency_list = {}
    
    for course_id in catalog:
        if course_id not in completed_courses:
            in_degree[course_id] = 0
            adjacency_list[course_id] = []

    for course_id in in_degree:
        prereqs = catalog[course_id].get("prereqs", [])
        for prereq in prereqs:
            if prereq not in completed_courses:
                if prereq in adjacency_list:
                    adjacency_list[prereq].append(course_id)
                    in_degree[course_id] += 1
                else:
                    return [{"error": f"Missing prerequisite data for: {prereq}"}]

    semesters = []
    
    while in_degree:
        available_nodes = [n for n, d in in_degree.items() if d == 0]
        
        if not available_nodes:
            return [{"error": "Prerequisite cycle or logical deadlock detected."}]
            
        available_nodes.sort()
        current_semester_courses = []
        current_semester_credits = 0
        
        for course in available_nodes:
            credits = catalog[course].get("credits", 3)
            if current_semester_credits + credits <= max_credits:
                current_semester_courses.append(course)
                current_semester_credits += credits
        
        if not current_semester_courses:
            return [{"error": "Max credit boundary is too low."}]
            
        semesters.append(current_semester_courses)
        
        for course in current_semester_courses:
            del in_degree[course]
            for neighbor in adjacency_list.get(course, []):
                if neighbor in in_degree:
                    in_degree[neighbor] -= 1

    return semesters

@app.route("/")
def index():
    return render_template("index.html", firebase_config=get_firebase_config())

@app.route("/api/plan", methods=["POST"])
def get_plan():
    data = request.get_json() or {}
    completed = [c.strip().upper() for c in data.get("completed", []) if c.strip()]
    max_credits = int(data.get("max_credits", 15))
    
    roadmap = kahn_topological_sort(completed, max_credits)
    return jsonify({"roadmap": roadmap, "catalog": load_courses()})

if __name__ == "__main__":
    app.run(debug=True)