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
        root.geometry('1000x760')
        root.minsize(850, 660)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(3, weight=1)
        bridge = str(Path(options.app_root) / 'standalone' / 'desktop-bridge.js')
        loaded = subprocess.run([options.node, bridge, '--catalog'], capture_output=True, text=True, encoding='utf-8', timeout=15, check=True)
        catalog = {row['name']: row for row in json.loads(loaded.stdout)}
        project = tk.StringVar(value=options.project)
        source, folder = tk.StringVar(), tk.StringVar()
        source_mode = tk.StringVar(value='file')
        command, info, status = tk.StringVar(value='status'), tk.StringVar(), tk.StringVar(value='Ready')
        jobs, state = queue.Queue(), {'process': None, 'output': None}
        header = ttk.Frame(root, padding=20)
        header.grid(row=0, column=0, sticky='ew')
        header.columnconfigure(1, weight=1)
        ttk.Label(header, text='Ask AI', font=('', 22, 'bold')).grid(row=0, column=0, columnspan=3, sticky='w')
        ttk.Label(header, text='Convert documents once. Run AskAI commands without sending output through chat.').grid(row=1, column=0, columnspan=3, sticky='w', pady=(8, 16))

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
        conversion.columnconfigure(0, weight=1)
        modes = ttk.Frame(conversion)
        modes.grid(row=0, column=0, columnspan=2, sticky='w')
        ttk.Radiobutton(modes, text='Local File', variable=source_mode, value='file', command=lambda: mode_changed()).pack(side='left')
        ttk.Radiobutton(modes, text='YouTube / Web URL', variable=source_mode, value='url', command=lambda: mode_changed()).pack(side='left', padx=15)
        source_entry = ttk.Entry(conversion, textvariable=source, state='readonly')
        source_entry.grid(row=1, column=0, sticky='ew', pady=(4, 12))

        def browse_file():
            selected = filedialog.askopenfilename(filetypes=[('Documents and images', '*.pdf *.docx *.pptx *.xlsx *.xls *.png *.jpg *.jpeg *.bmp *.tif *.tiff *.html *.csv *.txt *.md'), ('All files', '*')])
            if selected:
                source.set(selected)
                folder.set(str(Path(selected).parent))

        file_button = ttk.Button(conversion, text='Choose File...', command=browse_file)
        file_button.grid(row=1, column=1, padx=(12, 0), pady=(4, 12))

        def mode_changed():
            source.set('')
            source_entry.configure(state='readonly' if source_mode.get() == 'file' else 'normal')
            file_button.configure(state='normal' if source_mode.get() == 'file' else 'disabled')
        ttk.Label(conversion, text='Output folder (file defaults to its own folder; YouTube defaults to project folder)').grid(row=2, column=0, columnspan=2, sticky='w')
        ttk.Entry(conversion, textvariable=folder).grid(row=3, column=0, sticky='ew', pady=(4, 12))
        ttk.Button(conversion, text='Browse...', command=lambda: browse_folder(folder)).grid(row=3, column=1, padx=(12, 0), pady=(4, 12))
        convert = ttk.Button(conversion, text='Convert', style='Primary.TButton', command=lambda: start({'kind': 'convert', 'source': source.get().strip(), 'folder': folder.get().strip()}))
        convert.grid(row=4, column=0, sticky='w')
        ttk.Label(conversion, text='Local extraction / OCR. YouTube needs captions + network. Existing Markdown stays intact.').grid(row=5, column=0, columnspan=2, sticky='w', pady=(8, 0))
        for column in range(3):
            commands.columnconfigure(column, weight=1, uniform='command-columns')
        picker = ttk.Combobox(commands, textvariable=command, values=sorted(catalog), state='readonly', width=22)
        ttk.Label(commands, text='Command').grid(row=0, column=0, sticky='w')
        ttk.Label(commands, text='Action').grid(row=0, column=1, sticky='w')
        picker.grid(row=1, column=0, sticky='ew', padx=(0, 8))
        action = tk.StringVar()
        action_picker = ttk.Combobox(commands, textvariable=action, state='readonly')
        action_picker.grid(row=1, column=1, sticky='ew', padx=(0, 8))
        environment = tk.StringVar()
        ttk.Label(commands, text='Environment').grid(row=0, column=2, sticky='w')
        environment_picker = ttk.Combobox(commands, textvariable=environment, state='readonly')
        environment_picker.grid(row=1, column=2, sticky='ew')
        environment_values = {}
        field_widgets, option_rows, definitions = {}, [], []
        ttk.Label(commands, text='Arguments', font=(theme['font'], theme['fontSize'], 'bold')).grid(row=2, column=0, columnspan=3, sticky='w', pady=(10, 2))
        form_canvas = tk.Canvas(commands, height=45, highlightthickness=0, background=theme['surface'])
        form_canvas.grid(row=3, column=0, columnspan=3, sticky='ew')
        form_scroll = ttk.Scrollbar(commands, orient='vertical', command=form_canvas.yview)
        form_scroll.grid(row=3, column=3, sticky='ns')
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
        def fit_controls():
            if fitting[0]:
                return
            fitting[0] = True
            selected = tabs.index(tabs.select())
            try:
                if selected == 1:
                    rows = len(field_widgets) + len(option_rows)
                    form_canvas.configure(height=max(1, min(170, rows * 36)))
                root.update_idletasks()
                page = [conversion, commands, help_tab][selected]
                tabs.configure(height=page.winfo_reqheight())
            finally:
                fitting[0] = False

        def value_widget(parent, field):
            if field.get('kind') == 'boolean':
                widget = ttk.Combobox(parent, values=['true', 'false'], state='readonly')
                widget.set('true')
            elif field.get('choices'):
                widget = ttk.Combobox(parent, values=field['choices'], state='readonly')
            else:
                widget = ttk.Entry(parent)
            return widget

        def add_option(initial=None):
            available = [row for row in visible_options() if row['flag'] not in [item['flag'].get() for item in option_rows]]
            if not available:
                status.set('All available options already added.')
                return
            panel = ttk.Frame(form_frame)
            panel.grid(row=100 + len(option_rows), column=0, columnspan=3, sticky='ew', pady=3)
            for column in range(3):
                panel.columnconfigure(column, weight=1, uniform='option-columns')
            flag = ttk.Combobox(panel, values=[row['flag'] for row in visible_options()], state='readonly')
            flag.grid(row=0, column=0, sticky='ew', padx=(0, 8))
            row = {'panel': panel, 'flag': flag, 'value': None}

            def configure_value(event=None):
                selected = next(item for item in definition()['options'] if item['flag'] == flag.get())
                if row['value']:
                    row['value'].destroy()
                row['value'] = value_widget(panel, selected)
                row['value'].grid(row=0, column=1, sticky='ew', padx=(0, 8))
                flag.configure(state='disabled' if selected['required'] else 'readonly')
                remove.configure(text='Required *' if selected['required'] else 'Remove', state='disabled' if selected['required'] else 'normal')

            def remove_option():
                panel.destroy()
                option_rows.remove(row)
                for index, item in enumerate(option_rows):
                    item['panel'].grid_configure(row=100 + index)
                fit_controls()

            remove = ttk.Button(panel, text='Remove', command=remove_option)
            remove.grid(row=0, column=2, sticky='e')
            flag.bind('<<ComboboxSelected>>', configure_value)
            flag.set(initial or available[0]['flag'])
            configure_value()
            option_rows.append(row)
            fit_controls()

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
            for field in visible_options():
                if field['required']:
                    add_option(field['flag'])
            if command.get() == 'status' and any(row['flag'] == 'brief' for row in visible_options()):
                add_option('brief')
            fit_controls()

        def describe(event=None):
            entry = catalog[command.get()]
            info.set(entry['summary'])
            definitions[:] = entry['variants']
            action_picker.configure(values=[row['label'] for row in definitions])
            action.set(definitions[0]['label'])
            refresh_form()

        picker.bind('<<ComboboxSelected>>', describe)
        action_picker.bind('<<ComboboxSelected>>', refresh_form)
        describe()
        buttons = ttk.Frame(commands)
        buttons.grid(row=4, column=0, columnspan=3, sticky='w', pady=(4, 0))
        ttk.Button(buttons, text='Add Option', command=add_option).pack(side='left', padx=(0, 8))
        def command_request():
            return {'kind': 'command', 'command': command.get(), 'variant': definition()['id'], 'environment': environment_values.get(environment.get(), ''), 'fields': {name: widget.get() for name, widget in field_widgets.items()}, 'options': [{'flag': row['flag'].get(), 'value': row['value'].get()} for row in option_rows]}

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
        ttk.Label(help_tab, text='Command').grid(row=0, column=0, sticky='w', padx=(0, 12))
        help_picker = ttk.Combobox(help_tab, textvariable=help_command, values=sorted(catalog), state='readonly')
        help_picker.grid(row=0, column=1, sticky='ew', padx=(0, 12))

        def show_help(event=None):
            start({'kind': 'command', 'command': 'help', 'args': 'command ' + help_command.get() + ' --advanced'})

        help_picker.bind('<<ComboboxSelected>>', show_help)
        ttk.Button(help_tab, text='Show Detailed Help', command=show_help).grid(row=0, column=2, sticky='w')
        ttk.Label(help_tab, text='Select A Command To Read Its Complete CLI Help In The Output Panel.').grid(row=1, column=0, columnspan=3, sticky='w', pady=(12, 0))
        ttk.Label(root, text='Output').grid(row=2, column=0, sticky='w', padx=20, pady=(14, 5))
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

        def show(text):
            output.configure(state='normal')
            output.delete('1.0', 'end')
            output.insert('1.0', text)
            output.configure(state='disabled')

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
            assert len(tabs.tabs()) == 3 and list(help_picker['values']) == sorted(catalog), 'Help Tab Missing'
            tabs.select(commands)
            tab_changed()
            command_height = int(tabs.cget('height'))
            assert not open_button.winfo_manager() and not folder_button.winfo_manager(), 'Markdown Controls Visible Outside Conversion'
            tabs.select(help_tab)
            fit_controls()
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
                    selected = [row['flag'].get() for row in option_rows]
                    assert all(row['flag'] in selected for row in visible_options() if row['required']), 'Required option missing: ' + name
            command.set('why')
            describe()
            assert len(field_widgets) == 1, 'Required positional field missing'
            command.set('start')
            describe()
            assert len(option_rows) == 1 and str(environment_picker.cget('state')) == 'readonly', 'Required options missing'
            command.set('mcp')
            describe()
            action.set('confirm')
            refresh_form()
            assert len(field_widgets) == 1 and len(option_rows) == 2, 'MCP confirm form missing'
            copied = []
            copy_text('first\nsecond\n\nthird', copied.append)
            assert copied == ['first\nsecond\n\nthird'], 'Multiline copy failed'
            assert str(source_entry.cget('state')) == 'readonly' and file_button.winfo_manager() == 'grid', 'File picker missing'
            root.after(300, root.destroy)
        root.mainloop()
    except Exception as error:
        if options.ready:
            Path(options.ready).write_text(json.dumps({'ok': False, 'error': str(error)}), encoding='utf-8')
        raise


if __name__ == '__main__':
    main()
