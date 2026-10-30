#!/usr/bin/env python3
"""Ask AI's Linux desktop. Work is delegated to the same bounded Node CLI bridge."""
import argparse
import json
import os
from pathlib import Path
import queue
import shutil
import signal
import subprocess
import tempfile
import threading


def copy_text(text, sink):
    """Copy the complete display, preserving every line; sink is injectable for tests."""
    sink(text)


CATEGORY_ORDER = ['work', 'project', 'setup', 'health', 'cost', 'learn', 'system', 'more']
CATEGORY_LABEL = {'work': 'WORK', 'project': 'PROJECT', 'setup': 'SETUP', 'health': 'HEALTH',
                   'cost': 'COST & LEVERS', 'learn': 'LEARN', 'system': 'SYSTEM', 'more': 'MORE'}


def grouped_values(catalog):
    """Command names grouped by help category, with a separator heading per group."""
    out = []
    for cat in CATEGORY_ORDER:
        names = sorted(name for name, row in catalog.items() if row.get('category') == cat)
        if not names:
            continue
        out.append(f'── {CATEGORY_LABEL[cat]} ──')
        out.extend(names)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app-root', required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--project', default=str(Path.home()))
    parser.add_argument('--ready')
    parser.add_argument('--smoke-test', action='store_true')
    options = parser.parse_args()
    try:
        import tkinter as tk
        from tkinter import ttk, filedialog, messagebox
        root = tk.Tk()
        theme = json.loads((Path(options.app_root) / 'standalone' / 'desktop-theme.json').read_text(encoding='utf-8'))
        style = ttk.Style(root)
        style.theme_use('clam')
        root.configure(background=theme['background'])
        root.option_add('*Font', (theme['font'], theme['fontSize']))
        style.configure('.', font=(theme['font'], theme['fontSize']), foreground=theme['text'])
        style.configure('TFrame', background=theme['surface'])
        style.configure('TLabel', background=theme['surface'])
        style.configure('TButton', background=theme['secondary'], foreground=theme['accent'], padding=(10, 6), borderwidth=1)
        style.map('TButton', background=[('active', theme['accent'])], foreground=[('active', theme['surface'])])
        style.configure('Primary.TButton', background=theme['accent'], foreground=theme['surface'])
        style.map('Primary.TButton', background=[('active', theme['accent'])], foreground=[('active', theme['surface'])])
        style.configure('TEntry', fieldbackground=theme['surface'])
        style.map('TEntry', fieldbackground=[('readonly', theme['surface'])])
        style.configure('TCombobox', fieldbackground=theme['surface'], padding=4)
        style.map('TCombobox', fieldbackground=[('readonly', theme['surface'])])
        style.configure('TNotebook', background=theme['background'], borderwidth=0)
        style.configure('TNotebook.Tab', padding=(14, 7), background=theme['secondary'])
        style.map('TNotebook.Tab', background=[('selected', theme['surface'])], foreground=[('selected', theme['accent'])])
        root.title('Ask AI')
        try:
            icon_path = Path(options.app_root) / 'standalone' / 'askai.png'
            if icon_path.exists():
                # A local is enough to keep this alive: this function does not return until the window
                # closes, so its locals (unlike a short-lived helper's) outlive the running mainloop.
                icon_image = tk.PhotoImage(file=str(icon_path))
                root.iconphoto(True, icon_image)
        except Exception:
            pass  # keep the window manager's default icon
        root.geometry('1000x760')
        root.minsize(850, 660)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(3, weight=1)
        bridge = str(Path(options.app_root) / 'standalone' / 'desktop-bridge.js')
        loaded = subprocess.run([options.node, bridge, '--catalog'], capture_output=True, text=True, encoding='utf-8', timeout=15, check=True)
        catalog = {row['name']: row for row in json.loads(loaded.stdout)}
        # askai install --convert-only (just the desktop app and markitdown): open straight to Convert To Markdown
        # and grey out Commands/Help, since there is no Claude Code/Codex/Antigravity/Cursor setup for them to touch.
        convert_only = False
        try:
            mode_result = subprocess.run([options.node, bridge, '--mode'], capture_output=True, text=True, encoding='utf-8', timeout=15, check=True)
            convert_only = bool(json.loads(mode_result.stdout).get('convertOnly'))
        except Exception:
            pass  # best-effort: a failed check just leaves every tab enabled
        project = tk.StringVar(value=options.project)
        source, folder = tk.StringVar(), tk.StringVar()
        source_mode = tk.StringVar(value='file')
        command, info, status = tk.StringVar(value='status'), tk.StringVar(), tk.StringVar(value='Ready')
        last_command, last_help_command = 'status', 'status'
        jobs, state = queue.Queue(), {'process': None, 'output': None}
        header = ttk.Frame(root, padding=20)
        header.grid(row=0, column=0, sticky='ew')
        header.columnconfigure(1, weight=1)
        banner = tk.Frame(header, background=theme['navy'], height=64)
        banner.grid(row=0, column=0, columnspan=3, sticky='ew', pady=(0, 16))
        banner.grid_propagate(False)
        chip = tk.Canvas(banner, width=56, height=56, background=theme['navy'], highlightthickness=0)
        chip.place(x=8, y=4)
        chip.create_oval(4, 4, 44, 44, fill=theme['teal'], outline='')
        chip.create_text(24, 24, text='AI', fill='white', font=(theme['font'], 13, 'bold'))
        tk.Label(banner, text='Ask AI', font=(theme['font'], 22, 'bold'), background=theme['navy'], foreground='white').place(x=64, y=2)
        tk.Label(banner, text='Convert documents once. Run AskAI commands without sending output through chat.', font=(theme['font'], 9), background=theme['navy'], foreground=theme['secondary']).place(x=64, y=38)

        def browse_folder(variable):
            selected = filedialog.askdirectory(initialdir=variable.get() or project.get())
            if selected:
                variable.set(selected)

        ttk.Label(header, text='Project Folder').grid(row=2, column=0, padx=(0, 15))
        ttk.Entry(header, textvariable=project).grid(row=2, column=1, sticky='ew')
        ttk.Button(header, text='Browse...', command=lambda: browse_folder(project)).grid(row=2, column=2, padx=(12, 0))
        tabs = ttk.Notebook(root)
        tabs.grid(row=1, column=0, sticky='ew', padx=20)
        conversion, commands, help_tab = ttk.Frame(tabs, padding=15), ttk.Frame(tabs, padding=15), ttk.Frame(tabs, padding=15)
        tabs.add(conversion, text='Convert To Markdown')
        tabs.add(commands, text='Ask AI Commands')
        tabs.add(help_tab, text='Ask AI Help')
        if convert_only:
            tabs.tab(commands, state='disabled')
            tabs.select(conversion)
        conversion.columnconfigure(0, weight=1)
        modes = ttk.Frame(conversion)
        modes.grid(row=0, column=0, columnspan=2, sticky='w')
        ttk.Radiobutton(modes, text='Local File', variable=source_mode, value='file', command=lambda: mode_changed()).pack(side='left')
        url_mode_btn = ttk.Radiobutton(modes, text='YouTube / Web URL', variable=source_mode, value='url', command=lambda: mode_changed())
        url_mode_btn.pack(side='left', padx=15)
        if convert_only:
            url_mode_btn.state(['disabled'])
        ttk.Radiobutton(modes, text='Local Folder', variable=source_mode, value='folder', command=lambda: mode_changed()).pack(side='left')
        source_entry = ttk.Entry(conversion, textvariable=source, state='readonly')
        source_entry.grid(row=1, column=0, sticky='ew', pady=(4, 12))

        def browse_file():
            if source_mode.get() == 'folder':
                selected = filedialog.askdirectory()
                if selected:
                    source.set(selected)
                return
            selected = filedialog.askopenfilename(filetypes=[('Documents and images', '*.pdf *.docx *.pptx *.xlsx *.xls *.png *.jpg *.jpeg *.bmp *.tif *.tiff *.html *.csv *.txt *.md'), ('All files', '*')])
            if selected:
                source.set(selected)
                folder.set(str(Path(selected).parent))

        file_button = ttk.Button(conversion, text='Choose File...', command=browse_file)
        file_button.grid(row=1, column=1, padx=(12, 0), pady=(4, 12))

        def mode_changed():
            source.set('')
            mode = source_mode.get()
            source_entry.configure(state='normal' if mode == 'url' else 'readonly')
            file_button.configure(state='disabled' if mode == 'url' else 'normal', text='Choose Folder...' if mode == 'folder' else 'Choose File...')
        ttk.Label(conversion, text='Output folder (file defaults to its own folder; YouTube/folder default to project folder)').grid(row=2, column=0, columnspan=2, sticky='w')
        ttk.Entry(conversion, textvariable=folder).grid(row=3, column=0, sticky='ew', pady=(4, 12))
        ttk.Button(conversion, text='Browse...', command=lambda: browse_folder(folder)).grid(row=3, column=1, padx=(12, 0), pady=(4, 12))
        convert = ttk.Button(conversion, text='Convert', style='Primary.TButton', command=lambda: start({'kind': 'convert', 'source': source.get().strip(), 'folder': folder.get().strip()}))
        convert.grid(row=4, column=0, sticky='w')
        ttk.Label(conversion, text='Local extraction / OCR. YouTube needs captions + network. Existing Markdown stays intact.\nLocal Folder converts every supported file directly inside it (not subfolders) into the output folder.').grid(row=5, column=0, columnspan=2, sticky='w', pady=(8, 0))
        commands.rowconfigure(0, weight=1)
        commands.columnconfigure(0, weight=1)
        split = ttk.Panedwindow(commands, orient='horizontal')
        split.grid(row=0, column=0, sticky='nsew')
        left = ttk.Frame(split, padding=(0, 0, 8, 0))
        command_output = ttk.Frame(split)
        split.add(left, weight=2)
        split.add(command_output, weight=3)
        for column in range(3):
            left.columnconfigure(column, weight=1, uniform='command-columns')
        picker = ttk.Combobox(left, textvariable=command, values=grouped_values(catalog), state='readonly', width=22)
        ttk.Label(left, text='Command', font=(theme['font'], theme['fontSize'], 'bold')).grid(row=0, column=0, sticky='w')
        ttk.Label(left, text='Action', font=(theme['font'], theme['fontSize'], 'bold')).grid(row=0, column=1, sticky='w')
        picker.grid(row=1, column=0, sticky='ew', padx=(0, 8))
        action = tk.StringVar()
        action_picker = ttk.Combobox(left, textvariable=action, state='readonly')
        action_picker.grid(row=1, column=1, sticky='ew', padx=(0, 8))
        environment = tk.StringVar()
        ttk.Label(left, text='Environment', font=(theme['font'], theme['fontSize'], 'bold')).grid(row=0, column=2, sticky='w')
        environment_picker = ttk.Combobox(left, textvariable=environment, state='readonly')
        environment_picker.grid(row=1, column=2, sticky='ew')
        environment_values = {}
        field_widgets, option_rows, definitions = {}, [], []
        summary = ttk.Label(left, textvariable=info, wraplength=440)
        summary.grid(row=2, column=0, columnspan=3, sticky='ew', pady=(8, 0))
        ttk.Label(left, text='Arguments', font=(theme['font'], theme['fontSize'], 'bold')).grid(row=3, column=0, columnspan=3, sticky='w', pady=(10, 2))
        left.rowconfigure(3, weight=0)
        left.rowconfigure(5, weight=1)
        form_canvas = tk.Canvas(left, highlightthickness=0, background=theme['surface'])
        form_canvas.grid(row=5, column=0, columnspan=3, sticky='nsew')
        form_scroll = ttk.Scrollbar(left, orient='vertical', command=form_canvas.yview)
        form_scroll.grid(row=5, column=3, sticky='ns')
        form_canvas.configure(yscrollcommand=form_scroll.set)
        form_frame = ttk.Frame(form_canvas)
        form_window = form_canvas.create_window((0, 0), window=form_frame, anchor='nw')
        form_frame.bind('<Configure>', lambda event: form_canvas.configure(scrollregion=form_canvas.bbox('all')))
        form_canvas.bind('<Configure>', lambda event: form_canvas.itemconfigure(form_window, width=event.width))
        for column in range(3):
            form_frame.columnconfigure(column, weight=1, uniform='argument-columns')

        def definition():
            return next(row for row in definitions if row['label'] == action.get())

        def visible_fields():
            spec = definition()['environment']
            return [row for row in definition()['positionals'] if row['name'] != spec['field'] and row['name'] not in spec['hiddenFields']]

        def visible_options():
            return [row for row in definition()['options'] if row['flag'] != definition()['environment']['flag']]

        fitting = [False]
        output_place = [None]
        def fit_controls():
            if fitting[0]:
                return
            fitting[0] = True
            selected = tabs.index(tabs.select())
            try:
                place = output_place[0]
                if place and selected == 1 and not convert_only:
                    place()
                    return
                if place:
                    place()
                root.update_idletasks()
                page = [conversion, commands, help_tab][selected]
                tabs.configure(height=page.winfo_reqheight())
            finally:
                fitting[0] = False

        def value_widget(parent, field):
            if field.get('kind') == 'boolean':
                widget = ttk.Combobox(parent, values=['true', 'false'], state='readonly')
                widget.set('false')
            elif field.get('choices'):
                widget = ttk.Combobox(parent, values=field['choices'], state='readonly')
            elif field.get('suggestions'):
                # Unlike 'choices' above, this field also accepts free text (e.g. ask's fuzzy
                # search query): default (editable) state, not readonly.
                widget = ttk.Combobox(parent, values=field['suggestions'])
            else:
                widget = ttk.Entry(parent)
            return widget

        def refresh_form(event=None):
            for widget in form_frame.winfo_children():
                widget.destroy()
            field_widgets.clear()
            option_rows.clear()
            spec = definition()['environment']
            previous = environment.get()
            environment_values.clear()
            environment_values[spec['defaultLabel']] = ''
            environment_values.update({choice['label']: choice['value'] for choice in spec['choices']})
            environment_picker.configure(values=list(environment_values), state='readonly' if spec['supported'] else 'disabled')
            environment.set(previous if previous in environment_values else spec['defaultLabel'])
            for index, field in enumerate(visible_fields()):
                ttk.Label(form_frame, text=field['label'] + (' *' if field['required'] else ' (Optional)')).grid(row=index, column=0, sticky='w', padx=(0, 8), pady=4)
                widget = value_widget(form_frame, field)
                widget.grid(row=index, column=1, sticky='ew', padx=(0, 8), pady=4)
                field_widgets[field['name']] = widget
            start_row = len(visible_fields())
            for index, field in enumerate(visible_options()):
                ttk.Label(form_frame, text='--' + field['flag'] + (' *' if field['required'] else '')).grid(row=start_row + index, column=0, sticky='w', padx=(0, 8), pady=4)
                widget = value_widget(form_frame, field)
                widget.grid(row=start_row + index, column=1, sticky='ew', padx=(0, 8), pady=4)
                option_rows.append({'flag': field['flag'], 'value': widget})
            fit_controls()

        def describe(event=None):
            nonlocal last_command
            if command.get() not in catalog:
                command.set(last_command)
                return
            last_command = command.get()
            entry = catalog[command.get()]
            info.set(entry['summary'])
            definitions[:] = entry['variants']
            action_picker.configure(values=[row['label'] for row in definitions])
            action.set(definitions[0]['label'])
            refresh_form()

        picker.bind('<<ComboboxSelected>>', describe)
        action_picker.bind('<<ComboboxSelected>>', refresh_form)
        buttons = ttk.Frame(left)
        buttons.grid(row=6, column=0, columnspan=3, sticky='w', pady=(4, 0))
        describe()
        def include_option(spec, widget):
            value = widget.get()
            if spec.get('kind') == 'boolean':
                return value == 'true'
            if spec.get('required'):
                return True
            return bool(str(value).strip())

        def command_request():
            options = []
            for row in option_rows:
                spec = next(item for item in visible_options() if item['flag'] == row['flag'])
                if include_option(spec, row['value']):
                    options.append({'flag': row['flag'], 'value': row['value'].get()})
            return {'kind': 'command', 'command': command.get(), 'variant': definition()['id'], 'environment': environment_values.get(environment.get(), ''), 'fields': {name: widget.get() for name, widget in field_widgets.items()}, 'options': options}

        run = ttk.Button(buttons, text='Run Command', style='Primary.TButton', command=lambda: start(command_request()))
        run.pack(side='left')
        help_button = ttk.Button(buttons, text='Command Help', command=lambda: start({'kind': 'command', 'command': 'help', 'args': 'command ' + command.get()}))
        help_button.pack(side='left', padx=10)

        def terminal():
            candidates = [('x-terminal-emulator', ['-e']), ('gnome-terminal', ['--']), ('konsole', ['-e']), ('xfce4-terminal', ['-x']), ('xterm', ['-e'])]
            for executable, flags in candidates:
                if shutil.which(executable):
                    subprocess.Popen([executable, *flags, options.node, str(Path(options.app_root) / 'askai.js'), 'cli'], cwd=project.get(), start_new_session=True)
                    return
            messagebox.showinfo('Ask AI', 'No supported terminal found. Open your terminal and run askai cli.')

        ttk.Button(buttons, text='Open Terminal', command=terminal).pack(side='left')
        help_command = tk.StringVar(value='status')
        help_tab.columnconfigure(1, weight=1)
        ttk.Label(help_tab, text='Command', font=(theme['font'], theme['fontSize'], 'bold')).grid(row=0, column=0, sticky='w', padx=(0, 12))
        help_picker = ttk.Combobox(help_tab, textvariable=help_command, values=grouped_values(catalog), state='readonly')
        help_picker.grid(row=0, column=1, sticky='ew', padx=(0, 12))

        def show_help(event=None):
            nonlocal last_help_command
            if help_command.get() not in catalog:
                help_command.set(last_help_command)
                return
            last_help_command = help_command.get()
            start({'kind': 'command', 'command': 'help', 'args': 'command ' + help_command.get() + ' --advanced'})

        help_picker.bind('<<ComboboxSelected>>', show_help)
        ttk.Button(help_tab, text='Show Detailed Help', command=show_help).grid(row=0, column=2, sticky='w')
        output_label = tk.Label(root, text='OUTPUT', font=(theme['font'], 11, 'bold'), background=theme['background'], foreground=theme['teal'])
        output_label.grid(row=2, column=0, sticky='w', padx=20, pady=(14, 5))
        frame = ttk.Frame(root)
        frame.grid(row=3, column=0, sticky='nsew', padx=20)
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)
        output = tk.Text(frame, wrap='word', font=(theme['monospace'], theme['fontSize']), height=12, background=theme['surface'], foreground=theme['text'], selectbackground=theme['accent'], selectforeground=theme['surface'], relief='solid', borderwidth=1)
        output.grid(row=0, column=0, sticky='nsew')
        vertical, horizontal = ttk.Scrollbar(frame, command=output.yview), ttk.Scrollbar(frame, orient='horizontal', command=output.xview)
        vertical.grid(row=0, column=1, sticky='ns')
        horizontal.grid(row=1, column=0, sticky='ew')
        output.configure(yscrollcommand=vertical.set, xscrollcommand=horizontal.set)
        command_output.rowconfigure(0, weight=1)
        command_output.columnconfigure(0, weight=1)
        side = tk.Text(command_output, wrap='word', font=(theme['monospace'], theme['fontSize']), background=theme['surface'], foreground=theme['text'], selectbackground=theme['accent'], selectforeground=theme['surface'], relief='solid', borderwidth=1)
        side.grid(row=0, column=0, sticky='nsew')
        side_scroll = ttk.Scrollbar(command_output, command=side.yview)
        side_scroll.grid(row=0, column=1, sticky='ns')
        side.configure(yscrollcommand=side_scroll.set)

        def show(text):
            for widget in (output, side):
                widget.configure(state='normal')
                widget.delete('1.0', 'end')
                widget.insert('1.0', text)
                widget.configure(state='disabled')

        show('Ready. Conversion does not launch AI. Commands that launch AI can use your subscription.\nSelect output text and press Ctrl+C to copy.')
        footer = ttk.Frame(root, padding=20)
        footer.grid(row=4, column=0, sticky='ew')
        footer.columnconfigure(0, weight=1)
        ttk.Label(footer, textvariable=status).grid(row=0, column=0, sticky='w')

        def copy_output():
            try:
                root.clipboard_clear()
                copy_text(output.get('1.0', 'end-1c'), root.clipboard_append)
                status.set('Output copied.')
            except tk.TclError as error:
                status.set('Clipboard unavailable: ' + str(error))

        ttk.Button(footer, text='Copy Output', command=copy_output).grid(row=0, column=1, padx=6)

        def stop():
            process = state['process']
            if process and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)

        stop_button = ttk.Button(footer, text='Stop', command=stop, state='disabled')
        stop_button.grid(row=0, column=2, padx=6)

        def open_result(directory=False):
            if state['output']:
                path = Path(state['output'])
                subprocess.Popen(['xdg-open', str(path.parent if directory else path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

        open_button = ttk.Button(footer, text='Open Markdown', command=open_result, state='disabled')
        open_button.grid(row=0, column=3, padx=6)
        folder_button = ttk.Button(footer, text='Open Folder', command=lambda: open_result(True), state='disabled')
        folder_button.grid(row=0, column=4)
        def place_output():
            selected = tabs.index(tabs.select())
            if selected == 1 and not convert_only:
                output_label.grid_remove()
                frame.grid_remove()
                tabs.grid_configure(sticky='nsew')
                root.rowconfigure(1, weight=1)
                root.rowconfigure(3, weight=0)
                tabs.configure(height=max(480, root.winfo_height() - 240))
            else:
                output_label.grid()
                frame.grid(row=3, column=0, sticky='nsew', padx=20)
                tabs.grid_configure(sticky='ew')
                root.rowconfigure(1, weight=0)
                root.rowconfigure(3, weight=1)

        output_place[0] = place_output

        def tab_changed(event=None):
            fit_controls()
            conversion_selected = tabs.index(tabs.select()) == 0
            if conversion_selected:
                open_button.grid()
                folder_button.grid()
            else:
                open_button.grid_remove()
                folder_button.grid_remove()
            if tabs.index(tabs.select()) == 2:
                show_help()

        tabs.bind('<<NotebookTabChanged>>', tab_changed)
        ttk.Label(footer, text='No background AI or automatic analysis. Use Open terminal for interactive input.').grid(row=1, column=0, columnspan=5, sticky='w', pady=(12, 0))

        def start(request):
            if state['process']:
                return
            if not Path(project.get()).is_dir():
                messagebox.showerror('Ask AI', 'Choose an existing project folder.')
                return
            request['project'] = project.get()
            descriptor, file = tempfile.mkstemp(prefix='askai-desktop-', suffix='.json')
            with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
                json.dump(request, stream)
            try:
                process = subprocess.Popen([options.node, bridge, file], cwd=project.get(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', start_new_session=True)
            except Exception as error:
                Path(file).unlink(missing_ok=True)
                show(str(error))
                return
            state['process'], state['output'] = process, None
            for control in [run, convert, help_button, help_picker, open_button, folder_button]:
                control.configure(state='disabled')
            stop_button.configure(state='normal')
            status.set('Running...')
            show('Working...')

            def wait():
                try:
                    stdout, stderr = process.communicate()
                    result = json.loads(stdout) if stdout.strip() else {'code': process.returncode, 'stderr': 'Process exited without a result. ' + stderr}
                    jobs.put(result)
                except Exception as error:
                    jobs.put({'code': 1, 'stderr': str(error)})
                finally:
                    Path(file).unlink(missing_ok=True)

            threading.Thread(target=wait, daemon=True).start()

        def poll():
            try:
                result = jobs.get_nowait()
            except queue.Empty:
                pass
            else:
                state['process'] = None
                state['output'] = result.get('output')
                show(result.get('display') or '\n'.join(str(result.get(key, '')) for key in ['stdout', 'stderr'] if result.get(key)))
                status.set('Finished: exit ' + str(result.get('code', 1)))
                for control in [run, convert, help_button]:
                    control.configure(state='normal')
                help_picker.configure(state='readonly')
                stop_button.configure(state='disabled')
                if state['output']:
                    open_button.configure(state='normal')
                    folder_button.configure(state='normal')
            root.after(200, poll)

        def close():
            if state['process'] and not messagebox.askyesno('Ask AI', 'Stop the running operation and close Ask AI?'):
                return
            stop()
            root.destroy()

        root.protocol('WM_DELETE_WINDOW', close)
        if options.ready:
            root.after_idle(lambda: Path(options.ready).write_text('{"ok":true}', encoding='utf-8'))
        poll()
        if options.smoke_test:
            assert len(tabs.tabs()) == 3 and list(help_picker['values']) == grouped_values(catalog) == list(picker['values']), 'Help Tab Missing'
            if not convert_only:
                # Commands is disabled in convert-only mode (asserted below) and cannot be switched to.
                # Help stays enabled there (it only reads static text, see below), so this comparison
                # against Commands' height only runs where Commands is actually reachable.
                tabs.select(commands)
                tab_changed()
                command_height = int(tabs.cget('height'))
                assert side.master == command_output and not frame.winfo_manager(), 'Command output is not on the right'
                assert not open_button.winfo_manager() and not folder_button.winfo_manager(), 'Markdown Controls Visible Outside Conversion'
                tabs.select(help_tab)
                fit_controls()
                assert frame.winfo_manager() == 'grid', 'Help output left the shared pane'
                assert int(tabs.cget('height')) < command_height, 'Help Tab Wastes Output Space'
                tabs.select(conversion)
                tab_changed()
            assert open_button.winfo_manager() == 'grid', 'Markdown Controls Missing In Conversion'
            for name in catalog:
                command.set(name)
                describe()
                for form in definitions:
                    action.set(form['label'])
                    refresh_form()
                    assert len(field_widgets) == len(visible_fields()), 'Command fields missing: ' + name
                    selected = [row['flag'] for row in option_rows]
                    assert len(option_rows) == len(visible_options()), 'Command arguments missing: ' + name
                    assert all(row['flag'] in selected for row in visible_options() if row['required']), 'Required option missing: ' + name
            command.set('why')
            describe()
            assert len(field_widgets) == 1, 'Required positional field missing'
            command.set('start')
            describe()
            assert len(option_rows) == len(visible_options()) and str(environment_picker.cget('state')) == 'readonly', 'Required options missing'
            command.set('mcp')
            describe()
            action.set('confirm')
            refresh_form()
            assert len(field_widgets) == 1 and len(option_rows) == len(visible_options()), 'MCP confirm form missing'
            command.set('update')
            describe()
            dry = next(row for row in option_rows if row['flag'] == 'dry-run')
            assert dry['value'].get() == 'false', 'Auto-shown boolean option must default to false, not silently enable --dry-run'
            assert all(item['flag'] != 'dry-run' for item in command_request()['options']), 'Dry-run must stay off until chosen'
            command.set('ask')
            describe()
            assert len(field_widgets) == 1, 'Ask field missing'
            ask_field = next(iter(field_widgets.values()))
            assert isinstance(ask_field, ttk.Combobox) and str(ask_field.cget('state')) != 'readonly' and len(ask_field['values']) > 0, 'Ask suggestions dropdown missing or locked to exact matches'
            ask_field.set('free text search, not in the list')
            assert ask_field.get() == 'free text search, not in the list', 'Ask field must still accept free text'
            copied = []
            copy_text('first\nsecond\n\nthird', copied.append)
            assert copied == ['first\nsecond\n\nthird'], 'Multiline copy failed'
            assert str(source_entry.cget('state')) == 'readonly' and file_button.winfo_manager() == 'grid', 'File picker missing'
            source_mode.set('folder')
            mode_changed()
            assert str(source_entry.cget('state')) == 'readonly' and str(file_button.cget('state')) == 'normal' and file_button.cget('text') == 'Choose Folder...', 'Folder picker missing'
            if not convert_only:
                source_mode.set('url')
                mode_changed()
                assert str(source_entry.cget('state')) == 'normal' and str(file_button.cget('state')) == 'disabled', 'URL mode should allow typing and disable the picker'
            source_mode.set('file')
            mode_changed()
            assert (str(tabs.tab(commands, 'state')) == 'disabled') == convert_only, 'Commands enabled state does not match detected convert-only mode'
            assert str(tabs.tab(help_tab, 'state')) != 'disabled', 'Help must stay enabled in convert-only mode: it only reads static help text, nothing project-specific'
            if convert_only:
                assert tabs.index(tabs.select()) == tabs.index(conversion), 'Convert-only mode should open on Convert To Markdown'
            assert ('disabled' in url_mode_btn.state()) == convert_only, 'YouTube/Web URL enabled state does not match detected convert-only mode'
            root.after(300, root.destroy)
        root.mainloop()
    except Exception as error:
        if options.ready:
            Path(options.ready).write_text(json.dumps({'ok': False, 'error': str(error)}), encoding='utf-8')
        raise


if __name__ == '__main__':
    main()
