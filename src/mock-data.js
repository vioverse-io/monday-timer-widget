// Hardcoded demo-mode data. Mirrors the shape of data returned by monday-api.js
// so the renderer and timer engine behave identically in demo and real modes.

const MOCK_JOBS = [
  { id: '1', name: 'Command HPP - Medicare Provider Termination - 111122', assignedToMe: true, todayMs: 5025000, lastSessionAt: Date.now() - 1000 * 60 * 12 },
  { id: '2', name: 'Command Resi - Resi Daily - NYC Lead Inspections - 112300', assignedToMe: true, todayMs: 4320000, lastSessionAt: Date.now() - 1000 * 60 * 40 },
  { id: '3', name: 'Command VNS - Weekly Provider Term - 109437', assignedToMe: true, todayMs: 1320000, lastSessionAt: Date.now() - 1000 * 60 * 90 },
  { id: '4', name: '114041 - New Command Anthem Project', assignedToMe: true, todayMs: 0, lastSessionAt: Date.now() - 1000 * 60 * 60 * 26 },
  { id: '5', name: 'CarX - FTP data upload tests - 106536', assignedToMe: false, todayMs: 0, lastSessionAt: 0 },
  { id: '6', name: '114079 new VNS Command Recert letter', assignedToMe: true, todayMs: 0, lastSessionAt: Date.now() - 1000 * 60 * 60 * 30 },
  { id: '7', name: '112905 - HCHB, AgeIn, Docusign', assignedToMe: true, todayMs: 39562000, lastSessionAt: Date.now() - 1000 * 60 * 5 },
  { id: '8', name: '113035 Selective Inserting', assignedToMe: true, todayMs: 0, lastSessionAt: 0 },
  { id: '9', name: 'AAA Reading Berks IMS Midnight Job Number 113471', assignedToMe: true, todayMs: 0, lastSessionAt: 0 },
  { id: '10', name: 'Command HPP - New Medicaid and CHIP NDN/NOA - 113426', assignedToMe: true, todayMs: 0, lastSessionAt: 0 },
  { id: '11', name: '113516 IMS Testing Northampton Schuylkill', assignedToMe: true, todayMs: 0, lastSessionAt: 0 },
  { id: '12', name: 'CRM System Hoosier AAA Club Job Number 112616', assignedToMe: true, todayMs: 0, lastSessionAt: 0 }
];

const MOCK_GROUPS = [
  { id: 'g1', title: 'Priority - Assigned Projects', color: '#E2445C' },
  { id: 'g2', title: 'Low Priority Projects', color: '#0073EA' },
  { id: 'g3', title: 'Declined Requests', color: '#FDAB3D' }
];

const MOCK_USER = { id: '999', name: 'Demo User', email: 'demo@example.com' };

module.exports = { MOCK_JOBS, MOCK_GROUPS, MOCK_USER };
