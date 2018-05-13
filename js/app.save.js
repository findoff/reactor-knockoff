(function() {
'use strict';

// For iteration
var i;
var l;
var ri;
var pi;
var pl;
var ci;
var row;
var tile;
var upgrade;

var SAVE_MANAGER = function() {
	this.game;

	this.active_saver;

	this.init = function(game) {
		this.game = game;
	}
};

var save_manager = new SAVE_MANAGER();
window.save_manager = save_manager;

var LocalSaver = function() {
	this.save = function(data, callback) {
		save_manager.game.save_debug && console.log('LocalSaver.save');
		window.localStorage.setItem('rks', data);

		if ( callback ) {
			callback();
		}
	}

	this.enable = function() {
		save_manager.game.save_debug && console.log('LocalSaver.enable');
		localStorage.removeItem('google_drive_save');
		save_manager.active_saver = this;
	}

	this.load = function(callback) {
		save_manager.game.save_debug && console.log('LocalSaver.load');
		var rks = window.localStorage.getItem('rks');
		callback(rks);
	}
};

save_manager.LocalSaver = LocalSaver

var google_loaded = false;
var google_auth_called = false;

window.set_google_loaded = function() {
	game.save_debug && console.log('set_google_loaded');
	google_loaded = true;

	if ( google_auth_called ) {
		google_saver.checkAuth(null, true);
	}
};

var GoogleSaver = function() {
	var CLIENT_ID = '572695445092-svr182bgaass7vt97r5mnnk4phmmjh5u.apps.googleusercontent.com';
	var SCOPES = ['https://www.googleapis.com/auth/drive.appfolder'];
	var src = 'https://apis.google.com/js/client.js?onload=set_google_loaded';
	var filename = 'save.txt'
	var file_id = null;
	var file_meta = null;
	var tried_load = false;
	var load_callback = null;
	var self = this;
	var enable_callback;
	var access_token;

	// TODO: check if `google_loaded` can be safely used to replace this
	this.loadfailed = false;

	this.authChecked = false;

	this.enable = function(callback, event) {
		save_manager.game.save_debug && console.log('GoogleSaver.enable');
		enable_callback = callback;

		if ( google_loaded && this.authChecked === true && file_id !== null ) {
			if ( callback ) {
				callback();
			}

			return;
		} else if ( google_loaded ) {
			// If this was from a button click, open the popup
			self.checkAuth(null, event ? false : true);
		} else {
			// Make sure they can see the auth popup
			//show_page.call($('#options'), null);
			google_auth_called = true;
		}

		save_manager.active_saver = this;
	};

	this.save = function(data, callback) {
		save_manager.game.save_debug && console.log('GoogleSaver.save');
		local_saver.save(data);

		if ( google_loaded === true && this.authChecked === true && file_id !== null ) {
			update_file(data, callback);
		}
	};

	this.load = function(callback) {
		save_manager.game.save_debug && console.log('GoogleSaver.load');

		if ( file_meta !== null ) {
			download_file(file_meta, callback);
		} else {
			tried_load = true;
			load_callback = callback;
		}
	};

	var load_script = function() {
		var el = document.createElement('script');
		el.setAttribute('type', 'text/javascript');
		el.setAttribute('src', src);
		el.onerror = function(event) { self.loadfailed = true }

		document.getElementsByTagName('head')[0].appendChild(el);
	};

	/**
	 * Check if the current user has authorized the application.
	 */
	this.checkAuth = function(callback, immediate) {
		save_manager.game.save_debug && console.log('GoogleSaver.checkAuth');
		immediate = immediate || false;

		gapi.auth.authorize(
			{
				'client_id': CLIENT_ID,
				'scope': SCOPES,
				'immediate': immediate
			},
			function(authResult) {
				save_manager.game.save_debug && console.log('gapi.auth.authorize CB', authResult);

				if ( authResult && !authResult.error ) {
					google_loaded = true;
					self.authChecked = true;
					access_token = authResult['access_token'];
					// Access token has been successfully retrieved, requests can be sent to the API.
					localStorage.setItem('google_drive_save', 1);

					// We have a callback for refreshing the auth
					if ( callback ) {
						callback();
					} else {
						gapi.client.load('drive', 'v2', function(data) {
							save_manager.game.save_debug && console.log('gapi.client.load CB', data);
							get_file();
						});
					}

					//show_page.call($('#show_reactor'), null);
				} else if ( !immediate ) {
					// No access token could be retrieved
					local_saver.enable();
					save_game = local_saver;
					localStorage.removeItem('google_drive_save');
					enable_local_save();
					alert('Could not authorize. Switching to local save.')
				} else {
					self.checkAuth(callback, false);
				}
			}
		);
	};

	var update_file = function(data, callback) { 
		save_manager.game.save_debug && console.log('GoogleSaver update_file', data);
		data = data || '{}';
		var boundary = '-------314159265358979323846';
		var delimiter = "\r\n--" + boundary + "\r\n";
		var close_delim = "\r\n--" + boundary + "--";

		var contentType = 'text/plain';
		var base64Data = btoa(data);
		var multipartRequestBody =
			delimiter +
			'Content-Type: application/json\r\n\r\n' +
			JSON.stringify(file_meta) +
			delimiter +
			'Content-Type: ' + contentType + '\r\n' +
			'Content-Transfer-Encoding: base64\r\n' +
			'\r\n' +
			base64Data +
			close_delim;

		var request = gapi.client.request({
			'path': '/upload/drive/v2/files/' + file_id,
			'method': 'PUT',
			'params': {
				uploadType: 'multipart',
				alt: 'json'
			},
			'headers': {
				'Content-Type': 'multipart/mixed; boundary="' + boundary + '"'
			},
			'body': multipartRequestBody
		});

		request.execute(function(data) {
			save_manager.game.save_debug && console.log('gapi.client.request CB', data);

			if ( !data || data.error ) {
				if ( data.error.code === 404 ) {
					alert('It looks like the game was taken over in a new window - to take the game back, please refresh');
				} else {
					self.authChecked = false;
					// TODO: Use the refresh token instead
					self.checkAuth(function() {
						update_file(data, callback);
					}, true);
				}
			} else {
				if ( callback ) {
					callback();
				}
			}
		});
	}

	/**
	 * Permanently delete a file, skipping the trash.
	 *
	 * @param {String} fileId ID of the file to delete.
	 */
	var deleteFile = function(fileId, callback) {
		save_manager.game.save_debug && console.log('GoogleSaver deleteFile');
		var request = gapi.client.drive.files.delete({
			'fileId': fileId
		});

		request.execute(function(resp) {
			if ( callback ) callback();
		});
	}

	var get_file = function() {
		save_manager.game.save_debug && console.log('GoogleSaver get_file');
		/**
		 * List all files contained in the Application Data folder.
		 *
		 * @param {Function} callback Function to call when the request is complete.
		 */
		function listFilesInApplicationDataFolder(callback) {
			var retrievePageOfFiles = function(request, result) {
				request.execute(function(resp) {
					result = result.concat(resp.items);
					var nextPageToken = resp.nextPageToken;

					if (nextPageToken) {
						request = gapi.client.drive.files.list({
							'pageToken': nextPageToken
						});
						retrievePageOfFiles(request, result);
					} else {
						save_manager.game.save_debug && console.log('GoogleSaver retrievePageOfFiles CB', result);
						callback(result);
					}
				});
			}
			var initialRequest = gapi.client.drive.files.list({
				'q': '\'appfolder\' in parents'
			});
			retrievePageOfFiles(initialRequest, []);
		}

		listFilesInApplicationDataFolder(function(result) {
			save_manager.game.save_debug && console.log('GoogleSaver listFilesInApplicationDataFolder CB', result);

			for ( var i = 0, l = result.length; i < l; i++ ) {
				var file = result[i];

				// Found save file
				if ( file.title === filename ) {
					file_id = file.id;
					file_meta = file;

					if ( tried_load ) {
						self.load(load_callback);
					} else if ( enable_callback ) {
						enable_callback();
						enable_callback = null;
					}

					return;
				}
			}

			// No save file found, make a new one
			new_save_file(save_manager);
		});
	};

	var new_save_file = function(callback) {
		save_manager.game.save_debug && console.log('GoogleSaver new_save_file');
		var boundary = '-------314159265358979323846264';
		var delimiter = "\r\n--" + boundary + "\r\n";
		var close_delim = "\r\n--" + boundary + "--";

		var contentType = 'text/plain';
		var metadata = {
			'title': filename,
			'mimeType': contentType,
			'parents': [{'id': 'appfolder'}]
		};
		var base64Data = btoa(btoa(JSON.stringify({})));
		var multipartRequestBody =
			delimiter +
			'Content-Type: application/json\r\n\r\n' +
			JSON.stringify(metadata) +
			delimiter +
			'Content-Type: ' + contentType + '\r\n' +
			'Content-Transfer-Encoding: base64\r\n' +
			'\r\n' +
			base64Data +
			close_delim;
		var request = gapi.client.request({
			'path': '/upload/drive/v2/files',
			'method': 'POST',
			'params': {
				uploadType: 'multipart'
			},
			'headers': {
				'Content-Type': 'multipart/mixed; boundary="' + boundary + '"'
			},
			'body': multipartRequestBody
		});

		request.execute(function(arg) {
			save_manager.game.save_debug && console.log('gapi.client.request CB', arg);
			file_id = arg.id;
			file_meta = arg;
			if ( callback ) callback();
		});
	};

	/**
	 * Download a file's content.
	 *
	 * @param {File} file Drive File instance.
	 * @param {Function} callback Function to call when the request is complete.
	 */
	var download_file = function(file, callback) {
		save_manager.game.save_debug && console.log('GoogleSaver download_file');
		if ( file.downloadUrl ) {
			var accessToken = gapi.auth.getToken().access_token;
			var xhr = new XMLHttpRequest();
			xhr.open('GET', file.downloadUrl);
			xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
			xhr.onload = function() {
				file_meta = null;
				deleteFile(file_id, function() {
					file_id = null;

					new_save_file(function() {
						callback(xhr.responseText);
						// save game state
						save_manager();
					});
				});
			};
			xhr.onerror = function() {
				callback(null);
			};
			xhr.send();
		} else {
			callback(null);
		}
	}

	load_script();
};

save_manager.GoogleSaver = GoogleSaver;

function ExportAs() {
	var save_data = save_manager.game.saves();
	save_manager.active_saver.save(save_data);
	var saveAsBlob = new Blob([ save_data ], { type: 'text/plain' });
	var downloadLink = document.createElement("a");
	downloadLink.download = "reactor_knockoff_save.base64";
	downloadLink.innerHTML = "Download File";
	if (window.webkitURL != null) {
		// Chrome allows the link to be clicked without actually adding it to the DOM.
		downloadLink.href = window.webkitURL.createObjectURL(saveAsBlob);
	} else {
		// Firefox requires the link to be added to the DOM before it can be clicked.
		downloadLink.href = window.URL.createObjectURL(saveAsBlob);
		downloadLink.onclick = destroyClickedElement;
		downloadLink.style.display = "none";
		document.body.appendChild(downloadLink);
	}

	downloadLink.click();
}
$('#download_save').onclick = ExportAs;

var $import_button = $('#import_button');

function Export() {
	var save_data = save_manager.game.saves();
	save_manager.active_saver.save(save_data);
	$import_button.style.display = "none";
	$("#txtImportExport").value = save_data;
	$("#txtImportExport").select();
	$("#Import_Export_dialog").showModal();
}
$('#export_save').onclick = Export;

function ShowImport() {
	$import_button.style.display = null;
	$("#txtImportExport").value = "";
	$("#Import_Export_dialog").showModal();
}
$('#import_save').onclick = ShowImport;

function Import() {
	save_manager.game.loads($("#txtImportExport").value);
	$("#txtImportExport").value = "";
}
$import_button.onclick = Import;

$('#reset_game').onclick = function() {
	if (confirm("confirm reset game?")){
		save_manager.active_saver.save("");
		document.location.reload();
	}
}

$('#Import_Export_close_button').onclick = function() { $('#Import_Export_dialog').close() }
})();