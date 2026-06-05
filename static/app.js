const GRADE_OPTIONS = ['', 'A', 'B', 'C', 'D', 'F', 'T'];
const PASSING_GRADES = new Set(['A', 'B', 'C', 'T']);

const mapSelect = document.getElementById('mapSelect');
const completedInput = document.getElementById('completedInput');
const creditInput = document.getElementById('creditInput');
const outputContainer = document.getElementById('outputContainer');
const builderContainer = document.getElementById('builderContainer');
const previewContainer = document.getElementById('previewContainer');

let catalogData = {};
let currentMap = mapSelect ? mapSelect.value : '25-26';
let completedSet = new Set();
let builderState = { semesters: [] };

if (mapSelect && previewContainer) {
    renderMapPreview(currentMap);
    mapSelect.addEventListener('change', () => renderMapPreview(mapSelect.value));
}

// Auth Event Listeners
document.getElementById('loginBtn').addEventListener('click', () => {
    window.signInWithGoogle().catch(err => console.error('Login Error: ', err));
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    window.logoutUser().catch(err => console.error('Logout Error: ', err));
});

// Planner Engine
document.getElementById('plannerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawInput = completedInput.value;
    const maxCredits = creditInput.value;
    currentMap = mapSelect.value;

    const completed = rawInput.split(',').map(item => item.trim().toUpperCase()).filter(item => item.length > 0);
    completedSet = new Set(completed);

    outputContainer.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-success mb-3" role="status"></div>
            <p class="text-muted">Analyzing course map and prerequisite flow...</p>
        </div>
    `;

    try {
        const response = await fetch('/api/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                selected_map: currentMap,
                completed,
                max_credits: maxCredits
            })
        });

        if (!response.ok) throw new Error('Backend process failed.');

        const data = await response.json();
        catalogData = data.catalog || {};
        currentMap = data.selected_map || currentMap;

        renderRoadmap(data.roadmap, currentMap);
        initializeBuilder(data.roadmap);
    } catch (err) {
        outputContainer.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        builderContainer.innerHTML = '';
    }
});

function renderRoadmap(roadmap, selectedMap) {
    outputContainer.innerHTML = '';

    if (!Array.isArray(roadmap) || roadmap.length === 0) {
        outputContainer.innerHTML = `<div class="alert alert-success">All required courses are completed on this roadmap.</div>`;
        return;
    }

    if (roadmap[0].error) {
        outputContainer.innerHTML = `<div class="alert alert-warning">${roadmap[0].error}</div>`;
        return;
    }

    const header = document.createElement('div');
    header.className = 'mb-4';
    header.innerHTML = `
        <div class="d-flex align-items-center justify-content-between">
            <div>
                <h5 class="fw-bold">${selectedMap} Roadmap</h5>
                <p class="small text-muted mb-0">Courses in the selected UTD map. Completed classes are marked.</p>
            </div>
            <span class="badge bg-success">C or higher required</span>
        </div>
    `;
    outputContainer.appendChild(header);

    roadmap.forEach((semester, index) => {
        let coursesHtml = '';
        semester.courses.forEach(course => {
            const completedBadge = course.completed ? '<span class="badge bg-success ms-2">Completed</span>' : '';
            coursesHtml += `
                <div class="d-flex justify-content-between align-items-center p-3 mb-2 bg-white rounded border shadow-sm">
                    <div>
                        <span class="badge course-badge me-2 p-2">${course.id}</span>
                        <span class="fw-semibold text-dark">${course.title}</span>
                        ${completedBadge}
                    </div>
                    <span class="text-muted small fw-bold">${course.credits} credits</span>
                </div>
            `;
        });

        const semCard = document.createElement('div');
        semCard.className = 'card semester-card mb-4 border-0 shadow-sm';
        semCard.innerHTML = `
            <div class="card-header bg-light d-flex justify-content-between border-0 py-3">
                <h5 class="mb-0 fw-bold text-success">Semester ${index + 1}</h5>
                <span class="badge bg-secondary rounded-pill p-2">${semester.credits} Planned Credits</span>
            </div>
            <div class="card-body bg-light pt-0">${coursesHtml}</div>
        `;
        outputContainer.appendChild(semCard);
    });
}

function renderMapPreview(selectedMap) {
    if (!previewContainer || !window.courseMaps) return;

    const map = window.courseMaps[selectedMap];
    if (!map) {
        previewContainer.innerHTML = `<div class="alert alert-secondary">No roadmap preview available for ${selectedMap}.</div>`;
        return;
    }

    let totalCredits = 0;
    const semestersHtml = map.terms.map((term, index) => {
        let termCredits = 0;
        const coursesHtml = term.map(course => {
            termCredits += course.credits;
            return `
                <div class="d-flex justify-content-between align-items-center p-3 mb-2 bg-white rounded border shadow-sm">
                    <div>
                        <span class="badge course-badge me-2 p-2">${course.id}</span>
                        <span class="fw-semibold text-dark">${course.title}</span>
                    </div>
                    <span class="text-muted small fw-bold">${course.credits} credits</span>
                </div>
            `;
        }).join('');
        totalCredits += termCredits;
        return `
            <div class="card semester-card mb-4 border-0 shadow-sm">
                <div class="card-header bg-light d-flex justify-content-between border-0 py-3">
                    <h5 class="mb-0 fw-bold text-success">Semester ${index + 1}</h5>
                    <span class="badge bg-secondary rounded-pill p-2">${termCredits} Credits</span>
                </div>
                <div class="card-body bg-light pt-0">${coursesHtml}</div>
            </div>
        `;
    }).join('');

    const average = (totalCredits / map.terms.length).toFixed(1);
    previewContainer.innerHTML = `
        <div class="mb-4">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div>
                    <h6 class="fw-bold mb-1">${map.label}</h6>
                    <p class="small text-muted mb-0">Exact roadmap showing the planned 25-26 or 26-27 path.</p>
                </div>
                <div class="text-end">
                    <div class="small text-secondary">Average load</div>
                    <div class="fw-semibold">${average} credits / term</div>
                </div>
            </div>
        </div>
        ${semestersHtml}
    `;
}

function initializeBuilder(roadmap) {
    builderState.semesters = roadmap.map(term => {
        const rows = term.courses.filter(course => !course.completed).map(course => ({ courseId: course.id, grade: '' }));
        if (rows.length === 0) rows.push({ courseId: '', grade: '' });
        return { rows };
    });

    builderContainer.innerHTML = `
        <div class="card shadow-sm border-0 rounded-3 mb-4">
            <div class="card-body p-4">
                <div class="d-flex justify-content-between align-items-start mb-3">
                    <div>
                        <h4 class="card-title mb-1 fw-bold">Semester Schedule Builder</h4>
                        <p class="text-muted small mb-0">Select each semester's courses, mark grades or transfer credit, and validate prerequisites.</p>
                    </div>
                    <button id="resetBuilderBtn" class="btn btn-outline-secondary btn-sm">Reset Builder</button>
                </div>
                <div id="builderSummary" class="mb-3"></div>
                <div id="semesterBuilderRows"></div>
            </div>
        </div>
    `;

    document.getElementById('resetBuilderBtn').addEventListener('click', () => {
        if (!confirm('Reset the schedule builder and clear selected courses?')) return;
        initializeBuilder(roadmap);
    });

    renderSemesterBuilder();
}

function renderSemesterBuilder() {
    const container = document.getElementById('semesterBuilderRows');
    container.innerHTML = '';

    builderState.semesters.forEach((semester, semIndex) => {
        const rowsHtml = semester.rows.map((row, rowIndex) => renderBuilderRow(semIndex, rowIndex, row)).join('');

        const semCard = document.createElement('div');
        semCard.className = 'card mb-4 border-0 shadow-sm';
        semCard.innerHTML = `
            <div class="card-header bg-white border-0 d-flex justify-content-between align-items-center py-3">
                <div>
                    <h5 class="mb-0 fw-semibold">Semester ${semIndex + 1}</h5>
                    <p class="small text-muted mb-0">Choose UTD courses for this term.</p>
                </div>
                <button class="btn btn-sm btn-success builder-add-course" data-sem="${semIndex}">Add course</button>
            </div>
            <div class="card-body bg-light">${rowsHtml}</div>
        `;
        container.appendChild(semCard);
    });

    attachBuilderListeners();
    updateBuilderValidation();
}

function renderBuilderRow(semIndex, rowIndex, row) {
    const courseOptions = Object.keys(catalogData).sort().map(courseId => {
        const selected = row.courseId === courseId ? 'selected' : '';
        const title = catalogData[courseId].title || courseId;
        return `<option value="${courseId}" ${selected}>${courseId} — ${title}</option>`;
    }).join('');

    const gradeOptions = GRADE_OPTIONS.map(grade => {
        const selected = row.grade === grade ? 'selected' : '';
        const label = grade === '' ? 'Select grade / transfer' : grade;
        return `<option value="${grade}" ${selected}>${label}</option>`;
    }).join('');

    return `
        <div class="builder-row mb-3 p-3 rounded border bg-white">
            <div class="row g-3 align-items-end">
                <div class="col-md-6">
                    <label class="form-label fw-semibold">Course</label>
                    <select class="form-select builder-course-select" data-sem="${semIndex}" data-row="${rowIndex}">
                        <option value="">Select a course</option>
                        ${courseOptions}
                    </select>
                </div>
                <div class="col-md-4">
                    <label class="form-label fw-semibold">Grade / Transfer</label>
                    <select class="form-select builder-grade-select" data-sem="${semIndex}" data-row="${rowIndex}">
                        ${gradeOptions}
                    </select>
                </div>
                <div class="col-md-2 text-end">
                    <button type="button" class="btn btn-outline-danger btn-sm builder-remove-course" data-sem="${semIndex}" data-row="${rowIndex}">Remove</button>
                </div>
            </div>
            <div id="row-info-${semIndex}-${rowIndex}" class="mt-3 text-muted small"></div>
        </div>
    `;
}

function attachBuilderListeners() {
    document.querySelectorAll('.builder-course-select').forEach(select => {
        select.addEventListener('change', event => {
            const semIndex = Number(event.target.dataset.sem);
            const rowIndex = Number(event.target.dataset.row);
            builderState.semesters[semIndex].rows[rowIndex].courseId = event.target.value;
            renderSemesterBuilder();
        });
    });

    document.querySelectorAll('.builder-grade-select').forEach(select => {
        select.addEventListener('change', event => {
            const semIndex = Number(event.target.dataset.sem);
            const rowIndex = Number(event.target.dataset.row);
            builderState.semesters[semIndex].rows[rowIndex].grade = event.target.value;
            renderSemesterBuilder();
        });
    });

    document.querySelectorAll('.builder-remove-course').forEach(button => {
        button.addEventListener('click', event => {
            const semIndex = Number(event.target.dataset.sem);
            const rowIndex = Number(event.target.dataset.row);
            builderState.semesters[semIndex].rows.splice(rowIndex, 1);
            if (builderState.semesters[semIndex].rows.length === 0) {
                builderState.semesters[semIndex].rows.push({ courseId: '', grade: '' });
            }
            renderSemesterBuilder();
        });
    });

    document.querySelectorAll('.builder-add-course').forEach(button => {
        button.addEventListener('click', event => {
            const semIndex = Number(event.target.dataset.sem);
            builderState.semesters[semIndex].rows.push({ courseId: '', grade: '' });
            renderSemesterBuilder();
        });
    });
}

function updateBuilderValidation() {
    const summary = document.getElementById('builderSummary');
    const warnings = [];

    function buildPassedSet(semesterIndex) {
        const passed = new Set(Array.from(completedSet));
        for (let i = 0; i < semesterIndex; i += 1) {
            builderState.semesters[i].rows.forEach(row => {
                if (row.courseId && PASSING_GRADES.has(row.grade)) {
                    passed.add(row.courseId);
                }
            });
        }
        return passed;
    }

    builderState.semesters.forEach((semester, semIndex) => {
        semester.rows.forEach((row, rowIndex) => {
            const info = document.getElementById(`row-info-${semIndex}-${rowIndex}`);
            if (!info) return;

            if (!row.courseId) {
                info.innerHTML = '<span class="text-muted">Pick a course to inspect prerequisites and validation.</span>';
                return;
            }

            const courseData = catalogData[row.courseId] || { prereqs: [] };
            const prereqs = courseData.prereqs || [];
            const passedBefore = buildPassedSet(semIndex);
            const missing = prereqs.filter(pr => !passedBefore.has(pr));

            let infoHtml = `<div><strong>Prereqs:</strong> ${prereqs.length ? prereqs.join(', ') : 'None'}</div>`;
            if (missing.length) {
                warnings.push(`Semester ${semIndex + 1}, ${row.courseId}: missing ${missing.join(', ')} before this term.`);
                infoHtml += `<div class="text-danger">Missing prerequisite(s): ${missing.join(', ')}</div>`;
            } else {
                infoHtml += `<div class="text-success">Prerequisites satisfied with prior courses.</div>`;
            }

            if (completedSet.has(row.courseId)) {
                infoHtml += `<div class="text-info">Already marked complete in completed courses.</div>`;
            }

            if (row.grade && !PASSING_GRADES.has(row.grade)) {
                warnings.push(`Semester ${semIndex + 1}, ${row.courseId}: grade ${row.grade} is below C.`);
                infoHtml += `<div class="text-warning">UTD requires C or better for this course.</div>`;
            }

            info.innerHTML = infoHtml;
        });
    });

    if (!summary) return;
    if (warnings.length === 0) {
        summary.innerHTML = `<div class="alert alert-success mb-0">No prerequisite or grade warnings detected. Your schedule plan looks valid.</div>`;
    } else {
        summary.innerHTML = `
            <div class="alert alert-warning mb-0">
                <strong>Validation warnings:</strong>
                <ul class="mb-0 mt-2">
                    ${warnings.slice(0, 6).map(w => `<li>${w}</li>`).join('')}
                </ul>
            </div>
        `;
    }
}
