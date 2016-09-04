(function( $ ) {
	var nfRadio = Backbone.Radio;
	var radioChannel = nfRadio.channel( 'file_upload' );

	var fileModel = Backbone.Model.extend( {
		id: 0,
		name: '',
		tmpName: '',
		fieldID: 0
	} );

	var fileCollection = Backbone.Collection.extend( {
		model: fileModel
	} );

	var fileView = Marionette.ItemView.extend( {
		tagName: 'nf-section',
		template: '#nf-tmpl-field-file-row',

		events: {
			'click .delete': 'clickDelete'
		},

		clickDelete: function( event ) {
			radioChannel.trigger( 'click:deleteFile', event, this.model );
		}

	} );

	var fileCollectionView = Marionette.CollectionView.extend( {
		childView: fileView
	} );

	var uploadController = Marionette.Object.extend( {

		$progress_bars: [],

		initialize: function() {
			this.listenTo( radioChannel, 'init:model', this.initFile );
			this.listenTo( radioChannel, 'render:view', this.initFileUpload );
			this.listenTo( radioChannel, 'click:deleteFile', this.deleteFile );
			radioChannel.reply( 'validate:required', this.validateRequired );
			radioChannel.reply( 'get:submitData', this.getSubmitData );
		},

		initFile: function( model ) {
			model.set( 'uploadMulti', 1 != model.get( 'upload_multi_count' ) ) ;
			model.set( 'uploadNonce', nf_upload.nonces.file_upload );

			var files = model.get( 'files' );
			if ( typeof files === 'undefined' ) {
				files = []
			}

			model.set( 'files', new fileCollection( files ) );
		},

		renderView: function( view ) {
			var el = $( view.el ).find( '.files_uploaded' );
			view.fileCollectionView = new fileCollectionView( {
				el: el,
				collection: view.model.get( 'files' ),
				thisModel: this.model
			} );

			view.model.bind( 'change:files', this.changeCollection, view );
		},

		changeCollection: function() {
			this.fileCollectionView.render();
		},

		getFieldID: function( e ) {
			var $parent = $( e.target ).parents( '.field-wrap' );

			return $parent.data( 'field-id' );
		},

		getProgressBar: function( e ) {
			var fieldID = this.getFieldID( e );

			return this.$progress_bars[ fieldID ];
		},

		resetProgress: function( e ) {
			var self = this;
			setTimeout( function() {
				self.getProgressBar( e ).css( 'width', 0 );
			}, 1500 );
		},

		checkFilesLimit: function( view, e, data ) {
			var limit = view.model.get( 'upload_multi_count' );

			if ( 1 == limit ) {
				return true;
			}

			var files = view.model.get( 'files' );

			if ( ( files && files.length >= limit ) || data.files.length > limit ) {
				var error_msg = nf_upload.strings.file_limit.replace( '%n', limit );
				alert( error_msg );
				return false;
			}

			return true;
		},

		showError: function( error, view ) {
			nfRadio.channel( 'fields' ).request( 'add:error', view.model.id, 'upload-file-error', error );
		},

		initFileUpload: function( view ) {
			var fieldID = view.model.id;
			var formID = view.model.get( 'formID' );
			var $file = $( view.el ).find( '.nf-element' );
			var $nonce = $( view.el ).find( '.nf-upload-nonce' );
			var $files_uploaded = $( view.el ).find( '.files_uploaded' );
			this.$progress_bars[ fieldID ] = $( view.el ).find( '.progress-bar' );
			var url = nfFrontEnd.adminAjax + '?action=nf_fu_upload';
			var self = this;
			var files = view.model.get( 'files' );

			this.renderView( view );

			$file.fileupload( {
				url: url,
				dataType: 'json',
				formData: {
					form_id: formID,
					field_id: view.model.id,
					nonce: $nonce.val()
				},
				messages: {
					maxFileSize: nf_upload.strings.max_file_size_error.replace( '%n', view.model.get( 'max_file_size_mb' ) )
				},
				singleFileUploads: false,
				maxFileSize: view.model.get( 'max_file_size' ),
				change: function( e, data ) {
					if ( !self.checkFilesLimit( view, e, data ) ) {
						return false;
					}
				},
				drop: function( e, data ) {
					if ( !self.checkFilesLimit( view, e, data ) ) {
						return false;
					}
				},
				done: function( e, data ) {
					if ( !data.result || data.result === undefined ) {
						self.showError( nf_upload.strings.unknown_upload_error, view );
						self.resetProgress( e );
						return;
					}

					if ( -1 === data.result ) {
						self.showError( nf_upload.strings.upload_error, view );
						self.resetProgress( e );
						return;
					}

					// Check for errors
					if ( data.result.errors.length ) {
						$.each( data.result.errors, function( index, error ) {
							self.showError( error, view );
						} );
					}

					if ( data.result.data.files === undefined || !data.result.data.files.length ) {
						self.resetProgress( e );

						return;
					}

					$.each( data.result.data.files, function( index, file ) {
						files.add( new fileModel( { name: file.name, tmp_name: file.tmp_name, fieldID: fieldID } ) );
					} );

					view.model.set( 'files', files );
					view.model.trigger( 'change:files', view.model );
					view.model.set( 'value', 1 );

					self.resetProgress( e );

					nfRadio.channel( 'fields' ).trigger( 'change:field', view.el, view.model );
					nfRadio.channel( 'form-' + formID ).trigger( 'enable:submit' );
				},
				start: function() {
					if ( 1 == view.model.get( 'upload_multi_count' ) ) {
						// Remove the files uploaded display and reset the collection
						$files_uploaded.empty();
						files.reset();
					}
					nfRadio.channel( 'fields' ).request( 'remove:error', view.model.id, 'upload-file-error' );
					nfRadio.channel( 'form-' + formID ).trigger( 'disable:submit', 'File upload in progress.' );
				},
				progressall: function( e, data ) {
					var progress = parseInt( data.loaded / data.total * 100, 10 );
					self.getProgressBar( e ).css( 'width', progress + '%' );
				}
			} ).on( 'fileuploadprocessalways', function( e, data ) {
				var index = data.index,
					file = data.files[ index ];
				if ( file.error ) {
					nfRadio.channel( 'fields' ).request( 'add:error', view.model.id, 'upload-file-error', file.error );
				}
			} ).prop( 'disabled', !$.support.fileInput )
				.parent().addClass( $.support.fileInput ? undefined : 'disabled' );
		},

		getSubmitData: function( fieldData, field ) {
			fieldData.files = field.get( 'files' );

			return fieldData;
		},

		deleteFile: function( event, model ) {
			event.preventDefault();
			model.collection.remove( model );
			// send off AJAX request to delete temp file or uploaded file

			var fieldModel = nfRadio.channel( 'fields' ).request( 'get:field', model.get( 'fieldID' ) );
			nfRadio.channel( 'fields' ).trigger( 'change:field', '', fieldModel );
		},

		/**
		 * Check files have been submitted successfully for required field check
		 *
		 * @param el
		 * @param model
		 * @returns {boolean}
		 */
		validateRequired: function( el, model ) {
			var files = model.get( 'files' );
			if ( typeof files === 'undefined' || !files.length ) {
				return false;
			}

			return true;
		}

	} );

	new uploadController();
})( jQuery );