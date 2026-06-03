from flask import Flask, render_template, request, jsonify
import firebase_admin
from firebase_admin import credentials, firestore

app = Flask(__name__)

# Initialize Firestore
# Note: If you have your firebase-key.json, place it in this folder.
# If not, the app gracefully falls back to the local UTD CS Catalog below.
try:
    cred = credentials.Certificate("firebase-key.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Successfully connected to Firestore!")
except Exception as e:
    print("Firebase key not found or invalid. Running application using local UTD CS catalog.")
    db = None

# Comprehensive UTD Computer Science Core Catalog
UTD_CS_CATALOG = {
    "CS1436": {"title": "Programming Fundamentals", "credits": 4, "prereqs": []},
    "CS1337": {"title": "Computer Science I", "credits": 3, "prereqs": ["CS1436"]},
    "CS2305": {"title": "Discrete Mathematics I", "credits": 3, "prereqs": []},
    "CS2336": {"title": "Computer Science II", "credits": 3, "prereqs": ["CS1337"]},
    "CS3305": {"title": "Discrete Mathematics II", "credits": 3, "prereqs": ["CS2305"]},
    "CS3345": {"title": "Data Structures & Introduction to Algorithmic Analysis", "credits": 3, "prereqs": ["CS2336", "CS2305"]},
    "CS3377": {"title": "C/C++ Programming in a UNIX Environment", "credits": 3, "prereqs": ["CS2336"]},
    "CS4340": {"title": "Computer Architecture", "credits": 3, "prereqs": ["CS3345", "CS3377"]},
    "CS4349": {"title": "Advanced Algorithm Design and Analysis", "credits": 3, "prereqs": ["CS3345", "CS3305"]}
}

def load_courses():
    """Fetches course documents from Firestore or drops back to local dictionary."""
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
    """
    Implements Kahn's Algorithm to sort courses dynamically 
    into valid, load-balanced semesters based on prerequisites.
    """
    catalog = load_courses()
    in_degree = {}
    adjacency_list = {}
    
    # Track only the courses the user still needs to take
    for course_id in catalog:
        if course_id not in completed_courses:
            in_degree[course_id] = 0
            adjacency_list[course_id] = []

    # Map dependencies among remaining classes
    for course_id in in_degree:
        prereqs = catalog[course_id].get("prereqs", [])
        for prereq in prereqs:
            if prereq not in completed_courses:
                if prereq in adjacency_list:
                    adjacency_list[prereq].append(course_id)
                    in_degree[course_id] += 1
                else:
                    # Prerequisite is missing entirely from track setup
                    return [{"error": f"Missing prerequisite profile for context: {prereq}"}]

    semesters = []
    
    while in_degree:
        # Find all classes where all prereqs are cleared (in-degree == 0)
        available_nodes = [node for node, degree in in_degree.items() if degree == 0]
        
        if not available_nodes:
            return [{"error": "Prerequisite cycle or logical deadlock detected in your degree path."}]
            
        # Sort structurally to keep progression clean (optional layout adjustment)
        available_nodes.sort()
        
        current_semester_courses = []
        current_semester_credits = 0
        
        # Allocate available classes up to the credit ceiling
        for course in available_nodes:
            credits = catalog[course].get("credits", 3)
            if current_semester_credits + credits <= max_credits:
                current_semester_courses.append(course)
                current_semester_credits += credits
        
        if not current_semester_courses:
            # If credit cap is too tight to allow even one class
            return [{"error": "Max credit boundary is lower than single class weights."}]
            
        semesters.append(current_semester_courses)
        
        # Remove taken courses and update remaining dependencies
        for course in current_semester_courses:
            del in_degree[course]
            for neighbor in adjacency_list.get(course, []):
                if neighbor in in_degree:
                    in_degree[neighbor] -= 1

    return semesters

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/plan", methods=["POST"])
def get_plan():
    data = request.get_json() or {}
    completed = [c.strip().upper() for c in data.get("completed", []) if c.strip()]
    max_credits = int(data.get("max_credits", 15))
    
    roadmap = kahn_topological_sort(completed, max_credits)
    return jsonify({"roadmap": roadmap, "catalog": load_courses()})

if __name__ == "__main__":
    app.run(debug=True)