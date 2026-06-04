// Auth Event Listeners
document.getElementById('loginBtn').addEventListener('click', () => {
    window.signInWithGoogle().catch(err => console.error("Login Error: ", err));
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    window.logoutUser().catch(err => console.error("Logout Error: ", err));
});

// Planner Engine
document.getElementById('plannerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawInput = document.getElementById('completedInput').value;
    const maxCredits = document.getElementById('creditInput').value;

    const completed = rawInput.split(',').map(item => item.trim()).filter(item => item.length > 0);
    const outputContainer = document.getElementById('outputContainer');
    
    outputContainer.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-success mb-3" role="status"></div>
            <p class="text-muted">Analyzing prerequisite paths...</p>
        </div>
    `;

    try {
        const response = await fetch('/api/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed, max_credits: maxCredits })
        });

        if (!response.ok) throw new Error('Backend process failed.');
        
        const data = await response.json();
        renderRoadmap(data.roadmap, data.catalog);

    } catch (err) {
        outputContainer.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
});

function renderRoadmap(roadmap, catalog) {
    const outputContainer = document.getElementById('outputContainer');
    outputContainer.innerHTML = '';

    if (roadmap.length === 0) {
        outputContainer.innerHTML = `<div class="alert alert-success">All required courses completed!</div>`;
        return;
    }

    if (roadmap[0].error) {
        outputContainer.innerHTML = `<div class="alert alert-warning">${roadmap[0].error}</div>`;
        return;
    }

    roadmap.forEach((semester, index) => {
        let semesterCredits = 0;
        let coursesHtml = '';

        semester.forEach(courseId => {
            const details = catalog[courseId] || { title: "Unknown Requirement", credits: 3 };
            semesterCredits += details.credits;
            
            coursesHtml += `
                <div class="d-flex justify-content-between align-items-center p-3 mb-2 bg-white rounded border shadow-sm">
                    <div>
                        <span class="badge course-badge me-2 p-2">${courseId}</span>
                        <span class="fw-semibold text-dark">${details.title}</span>
                    </div>
                    <span class="text-muted small fw-bold">${details.credits} Hours</span>
                </div>
            `;
        });

        const semCard = document.createElement('div');
        semCard.className = 'card semester-card mb-4 border-0 shadow-sm';
        semCard.innerHTML = `
            <div class="card-header bg-light d-flex justify-content-between border-0 py-3">
                <h5 class="mb-0 fw-bold text-success">Term ${index + 1}</h5>
                <span class="badge bg-secondary rounded-pill p-2">${semesterCredits} Credits</span>
            </div>
            <div class="card-body bg-light pt-0">${coursesHtml}</div>
        `;
        outputContainer.appendChild(semCard);
    });
}