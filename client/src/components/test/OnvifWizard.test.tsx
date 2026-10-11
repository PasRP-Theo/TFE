import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnvifWizard } from '../OnvifWizard';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const DISCOVER = {
  devices: [
    { host: '192.168.0.21', xaddr: 'http://192.168.0.21:8000/onvif/device_service', name: 'Jardin', hardware: 'RLC-510A', alreadyAdded: false },
    { host: '192.168.0.34', xaddr: 'http://192.168.0.34:2020/onvif/device_service', name: null, hardware: 'C210', alreadyAdded: true },
  ],
  brands: [{ id: 'tapo', label: 'TP-Link Tapo' }, { id: 'generic', label: 'Autre marque' }],
};

const CONNECTED = {
  method: 'onvif', manufacturer: 'Reolink', model: 'RLC-510A', suggestedName: 'Reolink RLC-510A',
  streamUrl: 'rtsp://192.168.0.21:554/h264Preview_01_main', codec: 'h264', codecLabel: 'H.264',
  width: 2560, height: 1920, transcode: false, verified: true, warning: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const callTo = (path: string) => fetchMock.mock.calls.find(([url]) => String(url).endsWith(path));

describe('OnvifWizard', () => {
  it('recherche, connexion puis ajout ; le mot de passe n\'est jamais mis dans l\'URL du flux', async () => {
    const onAdded = vi.fn();
    fetchMock
      .mockResolvedValueOnce(json(DISCOVER))
      .mockResolvedValueOnce(json(CONNECTED))
      .mockResolvedValueOnce(json({ id: 7, name: 'Portail' }, 201));

    render(<OnvifWizard onAdded={onAdded} />);

    expect(await screen.findByText('Jardin')).toBeTruthy();
    expect(screen.getByText('✓ Déjà ajoutée')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Connecter' }));
    fireEvent.change(screen.getByLabelText('Mot de passe de la caméra'), { target: { value: 'p@ss' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connecter' }));

    expect(await screen.findByText('✓ Caméra connectée')).toBeTruthy();
    expect(screen.getByText(/Reolink RLC-510A · 2560×1920 · H.264 · ONVIF/)).toBeTruthy();
    const connectBody = JSON.parse(callTo('/api/cameras/onvif/connect')![1].body);
    expect(connectBody).toMatchObject({ host: '192.168.0.21', username: 'admin', password: 'p@ss', brand: null });

    fireEvent.change(screen.getByLabelText('Nom de la caméra'), { target: { value: 'Portail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la caméra' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith({ id: 7, name: 'Portail' }));
    const addBody = JSON.parse(callTo('/api/cameras')![1].body);
    expect(addBody).toMatchObject({ name: 'Portail', rtsp_url: CONNECTED.streamUrl, username: 'admin', password: 'p@ss', model: 'RLC-510A' });
    expect(addBody.rtsp_url).not.toContain('p@ss');
  });

  it('caméra sans ONVIF : propose de choisir la marque puis réessaie avec', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ devices: [], brands: DISCOVER.brands }))
      .mockResolvedValueOnce(json({ error: 'Cette caméra ne répond pas en ONVIF', code: 'needs_brand', brands: DISCOVER.brands }, 422))
      .mockResolvedValueOnce(json({ ...CONNECTED, method: 'brand', manufacturer: 'TP-Link Tapo', model: null }));

    render(<OnvifWizard onAdded={vi.fn()} />);
    expect(await screen.findByText(/Aucune caméra ONVIF n'a répondu/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Adresse IP de la caméra'), { target: { value: '192.168.0.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    fireEvent.change(screen.getByLabelText('Mot de passe de la caméra'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connecter' }));

    expect(await screen.findByText('Cette caméra ne répond pas en ONVIF')).toBeTruthy();
    const brandSelect = screen.getByLabelText('Marque de la caméra');
    fireEvent.change(brandSelect, { target: { value: 'tapo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connecter' }));

    expect(await screen.findByText('✓ Caméra connectée')).toBeTruthy();
    const lastConnect = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/onvif/connect')).at(-1)!;
    expect(JSON.parse(lastConnect[1].body)).toMatchObject({ host: '192.168.0.50', brand: 'tapo' });
  });

  it('adresse IP invalide : bouton désactivé', async () => {
    fetchMock.mockResolvedValueOnce(json({ devices: [], brands: [] }));
    render(<OnvifWizard onAdded={vi.fn()} />);
    await screen.findByText(/Aucune caméra ONVIF/);
    fireEvent.change(screen.getByLabelText('Adresse IP de la caméra'), { target: { value: 'camera.local' } });
    expect((screen.getByRole('button', { name: 'Continuer' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
