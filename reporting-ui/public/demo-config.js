// Sample users for the demo kit (demo-kit.js). Personas, not accounts: the
// sign-in decides who this console acts as, and the name lands in the
// report (preparedBy) and every gate signal (reviewedBy / approvedBy).
window.DEMO_CONFIG = {
  key: 'regulatory',
  app: 'Bank Delta Nusantara',
  title: 'Konsol Pelaporan Regulator',
  lead: 'Staf pelaporan menyampaikan laporan berkala; checker kepatuhan, Direktur Kepatuhan, Direksi dan Komite Manajemen Risiko masing-masing memegang gerbangnya sendiri. Setiap alur adalah workflow Orkes, dan penyusun laporan tidak dapat menyetujui laporannya sendiri.',
  password: 'bdn-demo',
  workflows: {
    regulatory_report_submission: 'Penyampaian laporan',
    breach_remediation: 'Remediasi pelampauan',
  },
  roles: {
    preparer: 'Staf Pelaporan (Maker)',
    compliance_head: 'Kepala SKK Kepatuhan',
    compliance_director: 'Direktur Kepatuhan',
    board: 'Direksi',
    risk_committee: 'Komite Manajemen Risiko',
  },
  runRoles: { submission: 'preparer', remediation: 'preparer' },
  gates: {
    checker_ref: { role: 'compliance_head' },
    breach_checker_ref: { role: 'compliance_director' },
    board_ref: { role: 'board' },
    committee_ref: { role: 'risk_committee' },
  },
  personas: [
    { id: 'nadia', name: 'Nadia Putri', title: 'Staf Pelaporan Regulator', unit: 'Divisi Akuntansi dan Pelaporan', roles: ['preparer'],
      hint: 'Sampaikan laporan berkala dan buka kasus remediasi. Coba preset “Peringatan — checker”.' },
    { id: 'irawan', name: 'Irawan Saputro', title: 'Kepala Satuan Kerja Kepatuhan', unit: 'Direktorat Kepatuhan', roles: ['compliance_head'],
      hint: 'Setujui laporan yang memuat peringatan edit-check.' },
    { id: 'kartika', name: 'Kartika Sari', title: 'Direktur Kepatuhan', unit: 'Direksi', roles: ['compliance_director'],
      hint: 'Setujui pengungkapan pelampauan rasio sebelum laporan disampaikan.' },
    { id: 'linda', name: 'Linda Gunawan', title: 'Direktur Manajemen Risiko', unit: 'Ketua Komite Manajemen Risiko', roles: ['risk_committee'],
      hint: 'Setujui rencana tindak remediasi tingkat komite.' },
    { id: 'budi', name: 'Budi Hartanto', title: 'Direktur Utama', unit: 'Direksi', roles: ['board'],
      hint: 'Setujui rencana tindak remediasi tingkat Direksi.' },
  ],
};
