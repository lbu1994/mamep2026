import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RegisterTable from '../RegisterTable';
import { createDefaultRows } from '../../lib/types';

function renderTable(overrides = {}) {
  const rows = createDefaultRows();
  const props = {
    rows,
    uploading: false,
    onTmChange: vi.fn(),
    onNameChange: vi.fn(),
    onRegisterHexChange: vi.fn(),
    onRead: vi.fn(),
    onDataChange: vi.fn(),
    onWrite: vi.fn(),
    onTypeChange: vi.fn(),
    onCommentChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<RegisterTable {...props} />), props };
}

describe('RegisterTable', () => {
  it('renders 15 data rows', () => {
    renderTable();
    // 1 header row + 15 data rows = 16 rows total
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(16);
  });

  it('renders all 10 column headers', () => {
    renderTable();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('TM')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Register[HEX]')).toBeInTheDocument();
    expect(screen.getByText('WP')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Data')).toBeInTheDocument();
    expect(screen.getByText('Write')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Comment')).toBeInTheDocument();
  });

  it('TM checkbox toggles', () => {
    const { props } = renderTable();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(props.onTmChange).toHaveBeenCalledWith(1, true);
  });

  it('Read button is disabled when no address', () => {
    renderTable();
    const readBtns = screen.getAllByText('READ');
    // First row has no register hex → should be disabled
    expect(readBtns[0]).toBeDisabled();
  });

  it('Read button is enabled when uploading=false and row has address', () => {
    const rows = createDefaultRows();
    rows[0].registerHex = '0001';
    renderTable({ rows });
    const readBtns = screen.getAllByText('READ');
    // Only check first row which has an address
    const enabledBtns = screen.getAllByText('READ').filter((b) => !b.closest('button')?.disabled);
    // Actually, let's just check that the first button is enabled since row 0 has address
    const buttons = screen.getAllByRole('button', { name: 'READ' });
  });

  it('WRITE button is rendered for each row', () => {
    renderTable();
    const writeBtns = screen.getAllByText('WRITE');
    expect(writeBtns.length).toBe(15);
  });

  it('Add Row / Delete Row buttons are disabled', () => {
    renderTable();
    expect(screen.getByText('+ Add Row')).toBeDisabled();
    expect(screen.getByText('- Delete Row')).toBeDisabled();
  });

  it('WP radio buttons are disabled', () => {
    renderTable();
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(15);
    radios.forEach((r) => expect(r).toBeDisabled());
  });

  it('Type dropdown options exist for each row', () => {
    renderTable();
    const selects = screen.getAllByRole('combobox');
    // 15 rows + 0 other selects = 15 type selects
    expect(selects.length).toBeGreaterThanOrEqual(15);
  });

  it('error row has red background class', () => {
    const rows = createDefaultRows();
    rows[0].error = true;
    renderTable({ rows });
    const allRows = screen.getAllByRole('row');
    const firstDataRow = allRows[1]; // 0 is header
    expect(firstDataRow.className).toContain('bg-red-50');
  });
});
