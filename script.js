import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getDatabase, ref, set, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

// ─── CONFIGURAÇÃO FIREBASE ────────────────────────────────────────────────────
// NOTA: As credenciais do Firebase no cliente são seguras desde que as
// Security Rules do banco estejam configuradas corretamente (ver database.rules.json).
// Nunca coloque senhas de admin ou secrets de servidor aqui.
const firebaseConfig = {
  apiKey: "AIzaSyB0YiVG947vNloItp_TTKXR5VBkh63-dNc",
  authDomain: "eduarda-nails-6391d.firebaseapp.com",
  databaseURL: "https://eduarda-nails-6391d-default-rtdb.firebaseio.com",
  projectId: "eduarda-nails-6391d",
  storageBucket: "eduarda-nails-6391d.firebasestorage.app",
  messagingSenderId: "887960297983",
  appId: "1:887960297983:web:c7c144a738bf4ba54687ca"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const EXPIRY_MS = 60 * 60 * 1000; // 1 hora em ms

let selectedDate = "";
let selectedHourId = "";
let isAdmin = false;
let currentEditId = "";
let currentEditDate = "";
let tempHoursData = {};
let blockedDays = {};
let countdownIntervals = {};
let meuNumeroWhatsApp = ""; // carregado do Firebase, não hardcoded

let currentViewMonth = new Date().getMonth();
let currentViewYear = new Date().getFullYear();

// ─── SEGURANÇA: ESCAPE DE HTML ────────────────────────────────────────────────
// FIX #5: Evita XSS — nunca inserir dados do usuário diretamente em innerHTML
function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─── SEGURANÇA: VALIDAÇÃO DE TELEFONE ─────────────────────────────────────────
// FIX #6: Valida formato do telefone antes de salvar
function validarTelefone(fone) {
    const apenas_numeros = fone.replace(/\D/g, '');
    return /^\d{10,11}$/.test(apenas_numeros);
}

// ─── NAVEGAÇÃO ────────────────────────────────────────────────────────────────

window.showSection = (id) => {
    document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
    document.getElementById(id).style.display = 'block';
};

window.onload = () => {
    const aba = localStorage.getItem('abaDestino');
    if (aba) {
        showSection(aba);
        localStorage.removeItem('abaDestino');
    }

    // FIX #4: Carrega número do WhatsApp do Firebase em vez de hardcoded
    get(ref(db, 'config/contato')).then(snap => {
        if (snap.exists() && snap.val().whatsapp) {
            meuNumeroWhatsApp = snap.val().whatsapp;
        }
    });

    onValue(ref(db, 'config/bloqueios'), (snapshot) => {
        blockedDays = snapshot.val() || {};
        renderVisualCalendar();
    });

    // FIX #2: Monitora estado de autenticação real do Firebase
    onAuthStateChanged(auth, (user) => {
        if (user) {
            isAdmin = true;
            document.getElementById('adminLogin').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            loadAdminTab('pendentes');
        } else {
            isAdmin = false;
            document.getElementById('adminLogin').style.display = 'block';
            document.getElementById('adminPanel').style.display = 'none';
        }
    });

    setInterval(checkExpirations, 60 * 1000);
    checkExpirations();
};

// ─── EXPIRAÇÃO AUTOMÁTICA ─────────────────────────────────────────────────────

async function checkExpirations() {
    const now = Date.now();
    const snap = await get(ref(db, 'agendamentos'));
    if (!snap.exists()) return;
    const allDates = snap.val();
    const updates = {};

    for (const date in allDates) {
        for (const key in allDates[date]) {
            const h = allDates[date][key];
            if (h.status === 'pendente' && h.expiresAt && now > h.expiresAt) {
                updates[`agendamentos/${date}/${key}/status`] = 'expirado';
                updates[`agendamentos/${date}/${key}/expiredAt`] = now;
            }
        }
    }
    if (Object.keys(updates).length > 0) {
        await update(ref(db), updates);
    }
}

// ─── CALENDÁRIO ───────────────────────────────────────────────────────────────

window.changeMonth = (step) => {
    currentViewMonth += step;
    if (currentViewMonth > 11) { currentViewMonth = 0; currentViewYear++; }
    else if (currentViewMonth < 0) { currentViewMonth = 11; currentViewYear--; }
    selectedDate = "";
    document.getElementById('hoursGrid').innerHTML = "";
    renderVisualCalendar();
};

function renderVisualCalendar() {
    const grid = document.getElementById('visualCalendar');
    const monthDisplay = document.getElementById('monthDisplay');
    const prevBtn = document.getElementById('prevMonthBtn');
    const now = new Date();
    const monthNames = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

    prevBtn.style.visibility = (currentViewYear === now.getFullYear() && currentViewMonth === now.getMonth()) ? "hidden" : "visible";
    monthDisplay.innerText = `${monthNames[currentViewMonth]} ${currentViewYear}`;

    const firstDay = new Date(currentViewYear, currentViewMonth, 1).getDay();
    const lastDay = new Date(currentViewYear, currentViewMonth + 1, 0).getDate();
    grid.innerHTML = "";

    for (let i = 0; i < firstDay; i++) {
        const d = document.createElement('div');
        d.className = 'calendar-day empty';
        grid.appendChild(d);
    }
    for (let i = 1; i <= lastDay; i++) {
        const dateStr = `${currentViewYear}-${String(currentViewMonth + 1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.innerText = i;
        const dayDate = new Date(currentViewYear, currentViewMonth, i);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (blockedDays[dateStr] || dayDate < today) {
            dayEl.classList.add('blocked');
        } else {
            dayEl.onclick = () => {
                document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
                dayEl.classList.add('selected');
                document.getElementById('datePicker').value = dateStr;
                selectedDate = dateStr;
                loadHours();
            };
        }
        grid.appendChild(dayEl);
    }
}

// ─── HORÁRIOS (CLIENTE) ───────────────────────────────────────────────────────

window.loadHours = () => {
    const grid = document.getElementById('hoursGrid');
    if (!selectedDate) return;
    onValue(ref(db, `agendamentos/${selectedDate}`), (snapshot) => {
        grid.innerHTML = "";
        const data = snapshot.val();
        if (data) {
            Object.keys(data).sort().forEach(key => {
                const h = data[key];
                const displayStatus = (h.status === 'expirado') ? 'disponivel' : h.status;
                if (displayStatus === 'disponivel') {
                    const card = document.createElement('div');
                    card.className = 'card disponivel';
                    // FIX #5: Usando esc() para evitar XSS
                    card.innerHTML = `<h3>${esc(h.time)}</h3><p>DISPONÍVEL</p>`;
                    card.onclick = () => openModal(key, h.time);
                    grid.appendChild(card);
                } else if (displayStatus === 'pendente') {
                    const now = Date.now();
                    const remaining = h.expiresAt ? Math.max(0, h.expiresAt - now) : 0;
                    const mins = Math.floor(remaining / 60000);
                    const secs = Math.floor((remaining % 60000) / 1000);
                    const card = document.createElement('div');
                    card.className = 'card pendente';
                    card.dataset.expiry = h.expiresAt || 0;
                    card.dataset.id = key;
                    card.innerHTML = `<h3>${esc(h.time)}</h3><p>AGUARDANDO</p><span class="countdown">${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}</span>`;
                    grid.appendChild(card);
                    startCardCountdown(card, h.expiresAt);
                } else if (displayStatus === 'confirmado') {
                    const card = document.createElement('div');
                    card.className = 'card confirmado';
                    card.innerHTML = `<h3>${esc(h.time)}</h3><p>CONFIRMADO</p>`;
                    grid.appendChild(card);
                }
            });
        } else {
            grid.innerHTML = "<p style='grid-column:1/-1; text-align:center; color:#999;'>Nenhum horário disponível para esta data.</p>";
        }
    });
};

function startCardCountdown(card, expiresAt) {
    const id = card.dataset.id;
    if (countdownIntervals[id]) clearInterval(countdownIntervals[id]);
    countdownIntervals[id] = setInterval(() => {
        const remaining = Math.max(0, expiresAt - Date.now());
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const span = card.querySelector('.countdown');
        if (span) span.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        if (remaining <= 0) {
            clearInterval(countdownIntervals[id]);
            loadHours();
        }
    }, 1000);
}

// ─── MODAL CLIENTE ────────────────────────────────────────────────────────────

function openModal(id, time) {
    selectedHourId = id;
    document.getElementById('selectedDetails').innerText = `${selectedDate.split('-').reverse().join('/')} às ${time}`;
    document.getElementById('modal').style.display = 'flex';
}
window.closeModal = () => document.getElementById('modal').style.display = 'none';

window.saveBooking = async () => {
    const nome = document.getElementById('userName').value.trim();
    const fone = document.getElementById('userPhone').value.trim();
    if (!nome || !fone) return alert("Por favor, preencha seu nome e WhatsApp.");

    // FIX #6: Validação de telefone
    if (!validarTelefone(fone)) {
        return alert("WhatsApp inválido. Use apenas números com DDD (ex: 21999999999).");
    }

    // FIX #6: Validação básica de nome
    if (nome.length < 2 || nome.length > 80) {
        return alert("Por favor, insira um nome válido.");
    }

    const detailsText = document.getElementById('selectedDetails').innerText;
    const timeStr = detailsText.split(' às ')[1];
    const dateStr = detailsText.split(' às ')[0];

    const snap = await get(ref(db, `agendamentos/${selectedDate}/${selectedHourId}`));
    const current = snap.val();
    if (current && current.status !== 'disponivel' && current.status !== 'expirado') {
        alert("Este horário acabou de ser reservado. Por favor, escolha outro.");
        closeModal();
        return;
    }

    const expiresAt = Date.now() + EXPIRY_MS;
    try {
        // Salva apenas campos permitidos, com tamanho limitado
        await set(ref(db, `agendamentos/${selectedDate}/${selectedHourId}`), {
            time: timeStr,
            status: "pendente",
            nome: nome.substring(0, 80),
            telefone: fone.replace(/\D/g, '').substring(0, 11),
            bookedAt: Date.now(),
            expiresAt
        });

        // FIX #4: Usa número carregado do Firebase
        const numeroDestino = meuNumeroWhatsApp || "5521994796439";
        const msg = `Olá Duda Nails! Gostaria de confirmar meu agendamento:\n\n📌 *Nome:* ${nome}\n📅 *Data:* ${dateStr}\n⏰ *Horário:* ${timeStr}\n📱 *WhatsApp:* ${fone}`;
        const url = `https://wa.me/${numeroDestino}?text=${encodeURIComponent(msg)}`;
        closeModal();
        window.open(url, '_blank') || (window.location.href = url);
    } catch (e) {
        alert("Erro ao salvar agendamento. Tente novamente.");
    }
};

// ─── ADMIN LOGIN (Firebase Authentication) ────────────────────────────────────
// FIX #1 e #2: Substituído checkAdmin com senha hardcoded por Firebase Auth real.
// A senha não fica mais no código — é gerenciada pelo Firebase Authentication.
// Para configurar: acesse o Console do Firebase → Authentication → Users
// e adicione um usuário com o e-mail e senha da Duda.

window.checkAdmin = async () => {
    const email = document.getElementById('adminEmail').value.trim();
    const pass = document.getElementById('adminPass').value;

    if (!email || !pass) return alert("Preencha e-mail e senha.");

    try {
        await signInWithEmailAndPassword(auth, email, pass);
        // onAuthStateChanged cuida de exibir o painel automaticamente
    } catch (err) {
        console.error(err);
        alert("E-mail ou senha incorretos.");
    }
};

window.logoutAdmin = async () => {
    await signOut(auth);
    alert("Sessão encerrada.");
};

// ─── ADMIN ABAS ───────────────────────────────────────────────────────────────

window.loadAdminTab = (tab) => {
    // FIX #2: Garante que só admins autenticados executam ações admin
    if (!isAdmin) return;

    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = 'block';
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

    if (tab === 'pendentes') loadPendentes();
    else if (tab === 'confirmados') loadConfirmados();
    else if (tab === 'expirados') loadExpirados();
};

// ─── ABA PENDENTES ────────────────────────────────────────────────────────────

async function loadPendentes() {
    if (!isAdmin) return;
    const container = document.getElementById('pendentes-list');
    container.innerHTML = '<p class="loading-msg">Carregando...</p>';
    const snap = await get(ref(db, 'agendamentos'));
    container.innerHTML = '';
    if (!snap.exists()) { container.innerHTML = '<p class="empty-msg">Nenhum agendamento pendente.</p>'; return; }

    const allDates = snap.val();
    const now = Date.now();
    let found = false;

    Object.keys(allDates).sort().forEach(date => {
        Object.keys(allDates[date]).sort().forEach(key => {
            const h = allDates[date][key];
            if (h.status !== 'pendente') return;
            found = true;
            const remaining = h.expiresAt ? Math.max(0, h.expiresAt - now) : 0;
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            const [y, m, d] = date.split('-');
            const card = document.createElement('div');
            card.className = 'admin-booking-card pendente-card';
            // FIX #5: Usando esc() em todos os dados do usuário
            card.innerHTML = `
                <div class="booking-info">
                    <div class="booking-time">📅 ${esc(d)}/${esc(m)}/${esc(y)} · ⏰ ${esc(h.time)}</div>
                    <div class="booking-client">👤 ${esc(h.nome) || '—'}</div>
                    <div class="booking-phone">📱 ${esc(h.telefone) || '—'}</div>
                    <div class="booking-expiry countdown-admin" data-expiry="${h.expiresAt}">⏳ Expira em ${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}</div>
                </div>
                <div class="booking-actions">
                    <button class="btn-confirm-sm" onclick="adminConfirmar('${esc(date)}','${esc(key)}')">✅ Confirmar</button>
                    <button class="btn-whats-sm" onclick="adminWhatsApp('${esc(h.telefone)}','${esc(h.nome)}','${esc(date)}','${esc(h.time)}')">💬 WhatsApp</button>
                </div>`;
            container.appendChild(card);
            startAdminCountdown(card, h.expiresAt, date, key);
        });
    });
    if (!found) container.innerHTML = '<p class="empty-msg">✅ Nenhum agendamento pendente no momento.</p>';
}

function startAdminCountdown(card, expiresAt, date, key) {
    const span = card.querySelector('.countdown-admin');
    if (!span) return;
    const iv = setInterval(() => {
        const rem = Math.max(0, expiresAt - Date.now());
        const m = Math.floor(rem / 60000);
        const s = Math.floor((rem % 60000) / 1000);
        span.textContent = `⏳ Expira em ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        if (rem <= 0) {
            clearInterval(iv);
            span.textContent = '🔴 Expirado';
            card.classList.add('expired-card');
        }
    }, 1000);
}

// ─── ABA CONFIRMADOS ─────────────────────────────────────────────────────────

async function loadConfirmados() {
    if (!isAdmin) return;
    const container = document.getElementById('confirmados-list');
    container.innerHTML = '<p class="loading-msg">Carregando...</p>';
    const snap = await get(ref(db, 'agendamentos'));
    container.innerHTML = '';
    if (!snap.exists()) { container.innerHTML = '<p class="empty-msg">Nenhum agendamento confirmado.</p>'; return; }

    const allDates = snap.val();
    let found = false;

    Object.keys(allDates).sort().forEach(date => {
        Object.keys(allDates[date]).sort().forEach(key => {
            const h = allDates[date][key];
            if (h.status !== 'confirmado') return;
            found = true;
            const [y, m, d] = date.split('-');
            const card = document.createElement('div');
            card.className = 'admin-booking-card confirmado-card';
            card.innerHTML = `
                <div class="booking-info">
                    <div class="booking-time">📅 ${esc(d)}/${esc(m)}/${esc(y)} · ⏰ ${esc(h.time)}</div>
                    <div class="booking-client">👤 ${esc(h.nome) || '—'}</div>
                    <div class="booking-phone">📱 ${esc(h.telefone) || '—'}</div>
                </div>
                <div class="booking-actions">
                    <button class="btn-release-sm" onclick="adminLiberar('${esc(date)}','${esc(key)}')">🔓 Liberar</button>
                    <button class="btn-whats-sm" onclick="adminWhatsApp('${esc(h.telefone)}','${esc(h.nome)}','${esc(date)}','${esc(h.time)}')">💬 WhatsApp</button>
                </div>`;
            container.appendChild(card);
        });
    });
    if (!found) container.innerHTML = '<p class="empty-msg">Nenhum agendamento confirmado.</p>';
}

// ─── ABA EXPIRADOS ────────────────────────────────────────────────────────────

async function loadExpirados() {
    if (!isAdmin) return;
    const container = document.getElementById('expirados-list');
    container.innerHTML = '<p class="loading-msg">Carregando...</p>';
    const snap = await get(ref(db, 'agendamentos'));
    container.innerHTML = '';
    if (!snap.exists()) { container.innerHTML = '<p class="empty-msg">Nenhum agendamento expirado.</p>'; return; }

    const allDates = snap.val();
    let found = false;

    Object.keys(allDates).sort().reverse().forEach(date => {
        Object.keys(allDates[date]).sort().forEach(key => {
            const h = allDates[date][key];
            if (h.status !== 'expirado') return;
            found = true;
            const [y, m, d] = date.split('-');
            const card = document.createElement('div');
            card.className = 'admin-booking-card expirado-card';
            card.innerHTML = `
                <div class="booking-info">
                    <div class="booking-time">📅 ${esc(d)}/${esc(m)}/${esc(y)} · ⏰ ${esc(h.time)}</div>
                    <div class="booking-client">👤 ${esc(h.nome) || '—'}</div>
                    <div class="booking-phone">📱 ${esc(h.telefone) || '—'}</div>
                    <div class="booking-tag">⏱ Não confirmado a tempo</div>
                </div>
                <div class="booking-actions">
                    <button class="btn-confirm-sm" onclick="adminConfirmar('${esc(date)}','${esc(key)}')">✅ Confirmar Mesmo Assim</button>
                    <button class="btn-whats-sm" onclick="adminWhatsApp('${esc(h.telefone)}','${esc(h.nome)}','${esc(date)}','${esc(h.time)}')">💬 WhatsApp</button>
                </div>`;
            container.appendChild(card);
        });
    });
    if (!found) container.innerHTML = '<p class="empty-msg">Nenhum agendamento expirado.</p>';
}

// ─── AÇÕES ADMIN ──────────────────────────────────────────────────────────────

window.adminConfirmar = async (date, key) => {
    if (!isAdmin) return;
    await update(ref(db, `agendamentos/${date}/${key}`), { status: 'confirmado' });
    loadAdminTab(document.querySelector('.admin-tab-btn.active')?.dataset?.tab || 'pendentes');
};

window.adminLiberar = async (date, key) => {
    if (!isAdmin) return;
    const snap = await get(ref(db, `agendamentos/${date}/${key}`));
    const h = snap.val();
    await set(ref(db, `agendamentos/${date}/${key}`), { time: h.time, status: 'disponivel', nome: '' });
    loadAdminTab('confirmados');
};

window.adminWhatsApp = (telefone, nome, date, time) => {
    if (!isAdmin) return;
    if (!telefone) return alert("Telefone não disponível.");
    const [y, m, d] = date.split('-');
    const msg = `Olá ${nome}! 💅 Aqui é a Duda Nails. Estou entrando em contato sobre seu agendamento do dia ${d}/${m} às ${time}. Podemos confirmar?`;
    window.open(`https://wa.me/55${telefone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank');
};

// ─── PAINEL CONFIGURAR ────────────────────────────────────────────────────────

window.loadAdminHours = async () => {
    if (!isAdmin) return;
    const date = document.getElementById('adminDatePicker').value;
    if (!date) return;
    const snap = await get(ref(db, `agendamentos/${date}`));
    tempHoursData = snap.exists() ? snap.val() : {};
    renderEditList();
};

window.toggleBlockDay = async () => {
    if (!isAdmin) return;
    const date = document.getElementById('adminDatePicker').value;
    if (!date) return alert("Selecione uma data!");
    const isBlocked = blockedDays[date];
    await set(ref(db, `config/bloqueios/${date}`), isBlocked ? null : true);
    alert(isBlocked ? "Dia Liberado!" : "Dia Bloqueado!");
};

window.addNewHourField = () => {
    if (!isAdmin) return;
    const hora = prompt("Horário (ex: 14:00):");
    if (hora) {
        if (!/^\d{1,2}:\d{2}$/.test(hora)) return alert("Formato inválido. Use HH:MM (ex: 14:00)");
        const id = "h" + hora.replace(":", "");
        tempHoursData[id] = { time: hora, status: "disponivel", nome: "" };
        renderEditList();
    }
};

function renderEditList() {
    const container = document.getElementById('hoursEditList');
    container.innerHTML = "";
    Object.keys(tempHoursData).sort().forEach(key => {
        const item = tempHoursData[key];
        const div = document.createElement('div');
        div.className = "admin-hour-item";
        // FIX #5: esc() nos dados
        div.innerHTML = `<span>${esc(item.time)} <small style="color:#aaa;">(${esc(item.status)})</small></span> <button onclick="removeTempHour('${esc(key)}')" style="color:#E0385F; border:none; background:none; cursor:pointer; font-size:1.1rem;">✕</button>`;
        container.appendChild(div);
    });
}

window.removeTempHour = (key) => {
    if (!isAdmin) return;
    delete tempHoursData[key];
    renderEditList();
};

window.confirmAllChanges = async () => {
    if (!isAdmin) return;
    const date = document.getElementById('adminDatePicker').value;
    if (!date) return alert("Selecione uma data!");
    await set(ref(db, `agendamentos/${date}`), tempHoursData);
    alert("✅ Horários salvos com sucesso!");
    loadAdminHours();
};

// ─── MODAL ADMIN LEGADO (compatibilidade) ─────────────────────────────────────
window.closeAdminModal = () => document.getElementById('adminModal').style.display = 'none';
window.confirmarAgendamento = async () => {
    if (!isAdmin) return;
    const date = document.getElementById('adminDatePicker').value;
    if (!date || !currentEditId) return;
    await update(ref(db, `agendamentos/${date}/${currentEditId}`), { status: "confirmado" });
    closeAdminModal();
};
window.liberarAgendamento = async () => {
    if (!isAdmin) return;
    const date = document.getElementById('adminDatePicker').value;
    if (!date || !currentEditId) return;
    const snap = await get(ref(db, `agendamentos/${date}/${currentEditId}`));
    await set(ref(db, `agendamentos/${date}/${currentEditId}`), { time: snap.val().time, status: "disponivel", nome: "" });
    closeAdminModal();
};