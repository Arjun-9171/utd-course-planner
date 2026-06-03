document.getElementById('plannerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawInput = document.getElementById('completedInput').value;
    const maxCredits = document.getElementById('creditInput').value;

    // Parse comma-delimited courses safely
    const completed = rawInput
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);

    const outputContainer = document.getElementById('outputContainer');
    outputContainer.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-success mb-3" role="status"></div>
            <p class="text-muted">Analyzing prerequisite paths and loadbalancing semesters...</p>
        </div>
    `;

    try {
        const response = await fetch('/api/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed, max_credits: maxCredits })
        });

        if (!response.ok) throw new Error('Network computational handler failure.');
        
        const data = await response.json();
        renderRoadmap(data.roadmap, data.catalog);

    } catch (err) {
        outputContainer.innerHTML = `
            <div class="alert alert-danger border-0 shadow-sm" role="alert">
                <h5 class="fw-bold">API Engine Disconnect</h5>
                <p class="mb-0">${err.message}</p>
            </div>
        `;
    }
});

function renderRoadmap(roadmap, catalog) {
    const outputContainer = document.getElementById('outputContainer');
    outputContainer.innerHTML = '';

    if (roadmap.length === 0) {
        outputContainer.innerHTML = `
            <div class="alert alert-success text-center border-0 py-4 shadow-sm">
                <h5 class="fw-bold mb-1">🎉 Matrix Clear!</h5>
                <p class="mb-0 text-muted">All courses within the catalog stack match your completed track list.</p>
            </div>
        `;
        return;
    }

    if (roadmap[0].error) {
        outputContainer.innerHTML = `
            <div class="alert alert-warning border-0 shadow-sm" role="alert">
                <h5 class="fw-bold">Algorithmic Boundary Reached</h5>
                <p class="mb-0">${roadmap[0].error}</p>
            </div>
        `;
        return;
    }

    // Build the structural sequence UI
    roadmap.forEach((semester, index) => {
        let semesterCredits = 0;
        let coursesHtml = '';

        semester.forEach(courseId => {
            const details = catalog[courseId] || { title: "Unknown Program Requirement", credits: 3 };
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
            <div class="card-header bg-light d-flex justify-content-between align-items-center border-0 py-3">
                <h5 class="mb-0 fw-bold text-success">Term ${index + 1}</h5>
                <span class="badge bg-secondary rounded-pill p-2">${semesterCredits} Active Credits</span>
            </div>
            <div class="card-body bg-light pt-0">
                ${coursesHtml}
            </div>
        `;
        outputContainer.appendChild(semCard);
    });
}