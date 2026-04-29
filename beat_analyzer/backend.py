import os
import sys
import json
import tempfile
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, send_file
from werkzeug.utils import secure_filename
import numpy as np

app = Flask(__name__, static_folder='.', static_url_path='')
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

file2beats = None

def get_analyzer():
    global file2beats
    if file2beats is None:
        from beat_this.inference import File2Beats
        file2beats = File2Beats(checkpoint_path="final0", device="cpu", dbn=False)
        print("Beat analyzer loaded successfully")
    return file2beats

@app.route('/')
def index():
    return send_file('index.html')

@app.route('/api/health')
def health():
    return jsonify({'ok': True, 'message': 'Beat analyzer service ready'})

@app.route('/api/analyze', methods=['POST'])
def analyze():
    if 'file' not in request.files:
        return jsonify({'ok': False, 'message': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'ok': False, 'message': 'No file selected'}), 400

    filename = secure_filename(file.filename)
    temp_dir = tempfile.mkdtemp()
    filepath = os.path.join(temp_dir, filename)
    file.save(filepath)

    try:
        analyzer = get_analyzer()
        beats, downbeats = analyzer(filepath)

        beats_list = [float(b) for b in beats]
        downbeats_list = [float(b) for b in downbeats]

        bpm = calculate_bpm(beats_list)
        duration = get_duration(filepath)

        result = {
            'ok': True,
            'beats': [{'time': t, 'index': i+1, 'type': 'beat'} for i, t in enumerate(beats_list)],
            'downbeats': [{'time': t, 'index': i+1, 'type': 'downbeat'} for i, t in enumerate(downbeats_list)],
            'bpm': bpm,
            'duration': duration,
            'beatCount': len(beats_list),
            'downbeatCount': len(downbeats_list),
            'firstBeat': beats_list[0] if beats_list else None,
            'firstDownbeat': downbeats_list[0] if downbeats_list else None
        }

        all_beats = []
        downbeat_set = set([round(t, 3) for t in downbeats_list])
        for t in beats_list:
            all_beats.append({'time': t, 'type': 'downbeat' if round(t, 3) in downbeat_set else 'beat'})
        all_beats.sort(key=lambda x: x['time'])
        result['timeline'] = all_beats

        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'message': str(e)}), 500
    finally:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)

def calculate_bpm(beats):
    if len(beats) < 2:
        return None
    intervals = []
    for i in range(1, min(len(beats), 20)):
        intervals.append(beats[i] - beats[i-1])
    avg_interval = sum(intervals) / len(intervals)
    bpm = 60.0 / avg_interval
    if bpm < 40 or bpm > 300:
        return None
    return round(bpm, 1)

def get_duration(filepath):
    try:
        import soundfile as sf
        info = sf.info(filepath)
        return info.frames / info.samplerate
    except:
        return 0

if __name__ == '__main__':
    print('='*50)
    print('Starting Beat Analyzer...')
    print('Open http://localhost:5000 in your browser')
    print('='*50)
    app.run(host='0.0.0.0', port=5000, debug=False)